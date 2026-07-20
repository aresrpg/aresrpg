// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Transaction } from '@mysten/sui/transactions'

import {
  aresrpg_deployment,
  shared_object_arg,
} from '../../deployment/aresrpg.js'
import { as_object_arg } from '../object_arg.js'

// GIFT PTB BUILDERS for the merged `aresrpg` package's `gift` module — escrow-recoverable player-to-player item
// send (design `docs/ITEM_SEND_PLAN.md` §A4). Three signer-split doors:
//   • send(SENDER)    — funds the royalty escrow off the STAMPED floor (ITEM_ROYALTY_MIN_MIST, deployment/
//                       aresrpg.js — the item royalty floor is baked in at ceremony/
//                       stamp time like every other deployment id, NOT read from chain at runtime), then
//                       exclusively lists the N kiosk-locked items at min_price 0 and wraps the caps + the
//                       royalty coin (split EXACTLY off gas) into a shared `Gift`.
//   • claim(RECIPIENT)— consume the `Gift`, buy each item out of the sender's kiosk for 0, and resolve the FULL
//                       Item TransferPolicy receipt INSIDE the Move call (royalty paid from the escrow) — the
//                       item lands locked in the recipient's kiosk. Because the receipt tail runs on-chain, this
//                       is ONE clean moveCall: NO offline kiosk-rule resolution, so NONE of the InvalidLinkage
//                       money-path risk `items_marketplace.js` (buy) flags. The ITEM_POLICY is passed &mut
//                       (royalty_rule::pay adds to its balance).
//   • recall(SENDER)  — delist the caps back + refund the royalty (ownership-gated only, never freezable).
// Mirrors commission.js idioms (as_object_arg / shared_object_arg; ids resolve through the stamp-or-throw home).
//
// DRIFT POSTURE: royalty config changes flow through the ceremony-owned release config
// like every other deployment constant. An unrecorded on-chain re-tune UNDERFUNDS new gifts — the claim's
// escrow split aborts, never a silent success — recoverable via the sender's `recall` (never a fund loss).
//
// FROZEN Move signatures (read firsthand from packages/move/aresrpg/sources/gift.move):
//   public fun send(kiosk: &mut Kiosk, pkcap: &PersonalKioskCap, item_ids: vector<ID>, recipient: address,
//     royalty: Coin<SUI>, config: &GameConfig, version: &Version, ctx)
//   public fun claim(gift: Gift, sender_kiosk: &mut Kiosk, recipient_kiosk: &mut Kiosk,
//     recipient_pkcap: &PersonalKioskCap, policy: &mut TransferPolicy<Item>, config, version, ctx)
//   public fun recall(gift: Gift, sender_kiosk: &mut Kiosk, ctx)

/**
 * SEND `item_ids` (all kiosk-locked in the sender's kiosk) to `recipient`, pre-funding the royalty escrow that
 * makes the gift free to receive. Funds off the STAMPED floor `item_ids.length × a.ITEM_ROYALTY_MIN_MIST` —
 * REFUSES loudly if that stamp is missing/zero (never build a gift off a blank floor) or an explicit
 * `royalty_mist` is below it — an under-funded gift would be silently UNCLAIMABLE (the claim's escrow split
 * aborts). Omit `royalty_mist` to fund exactly the stamped floor; pass a higher value to over-fund (surplus
 * refunds at claim). The royalty coin is split EXACTLY off gas. The chain aborts `EEmptyGift` on an empty list;
 * `list_with_purchase_cap` aborts if an item is already listed.
 * @param {import("../../../types.js").Context} context
 */
export function gift_send_ptb(context) {
  const { network } = context
  return ({
    kiosk_id,
    personal_kiosk_cap_id,
    item_ids,
    recipient,
    royalty_mist,
    tx = new Transaction(),
  }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)
    if (!kiosk_id || !personal_kiosk_cap_id || !recipient)
      throw new Error(
        '[gift_send_ptb] kiosk_id, personal_kiosk_cap_id and recipient are required.',
      )
    if (!Array.isArray(item_ids) || item_ids.length === 0)
      throw new Error(
        '[gift_send_ptb] item_ids must be a non-empty array of kiosk-locked item ids.',
      )

    // The STAMPED royalty floor (never a chain read here — see the DRIFT POSTURE header note). Missing/zero
    // means an un-stamped network: refuse rather than build a gift that could be free (or unclaimable at 0).
    if (!a.ITEM_ROYALTY_MIN_MIST || BigInt(a.ITEM_ROYALTY_MIN_MIST) <= 0n)
      throw new Error(
        '[gift_send_ptb] ITEM_ROYALTY_MIN_MIST is not stamped in release.json for this network — run the publish/upgrade ceremony before composing a gift.',
      )
    const min_mist = BigInt(a.ITEM_ROYALTY_MIN_MIST)
    const floor = min_mist * BigInt(item_ids.length)
    const funded = royalty_mist == null ? floor : BigInt(royalty_mist)
    if (funded < floor)
      throw new Error(
        `[gift_send_ptb] royalty_mist ${funded} is below the stamped floor ${floor} (${item_ids.length} items × ${min_mist} ITEM_ROYALTY_MIN_MIST) — an under-funded gift is unclaimable.`,
      )

    const [royalty] = tx.splitCoins(tx.gas, [tx.pure.u64(funded)])
    tx.moveCall({
      target: `${a.GIFTING_PACKAGE_ID}::gift::send`,
      arguments: [
        as_object_arg(tx, kiosk_id), // kiosk: &mut Kiosk (the sender's)
        as_object_arg(tx, personal_kiosk_cap_id), // pkcap: &PersonalKioskCap (the sender's)
        tx.pure.vector('id', item_ids), // item_ids: vector<ID>
        tx.pure.address(recipient), // recipient: address
        royalty, // royalty: Coin<SUI> (pre-funded escrow — ~0.01 SUI × N)
        shared_object_arg(tx, network, 'GAME_CONFIG', false, a.GAME_CONFIG), // config: &GameConfig
        shared_object_arg(tx, network, 'VERSION', false, a.VERSION), // version: &Version
      ],
    })
    return tx
  }
}

/**
 * CLAIM a gift (RECIPIENT-only on-chain): consume the escrow, buy each item out of the SENDER's kiosk for 0, pay
 * the royalty from the escrowed balance, and land each item LOCKED in the recipient's kiosk — the full policy
 * receipt resolves INSIDE the Move call (one moveCall, no offline rule resolution). The ITEM_POLICY is passed
 * MUTABLE — `royalty_rule::pay` writes the royalty into the policy's balance. `sender_kiosk_id` is the sender's
 * kiosk the items are listed in (read off the gift's caps); the recipient's kiosk + pkcap are the destination.
 * @param {import("../../../types.js").Context} context
 */
export function gift_claim_ptb(context) {
  const { network } = context
  return ({
    gift_id,
    sender_kiosk_id,
    recipient_kiosk_id,
    personal_kiosk_cap_id,
    tx = new Transaction(),
  }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)
    if (
      !gift_id ||
      !sender_kiosk_id ||
      !recipient_kiosk_id ||
      !personal_kiosk_cap_id
    )
      throw new Error(
        '[gift_claim_ptb] gift_id, sender_kiosk_id, recipient_kiosk_id and personal_kiosk_cap_id are all required.',
      )
    tx.moveCall({
      target: `${a.GIFTING_PACKAGE_ID}::gift::claim`,
      arguments: [
        as_object_arg(tx, gift_id), // gift: Gift (shared, consumed BY VALUE + deleted)
        as_object_arg(tx, sender_kiosk_id), // sender_kiosk: &mut Kiosk (items are listed here)
        as_object_arg(tx, recipient_kiosk_id), // recipient_kiosk: &mut Kiosk (items land here, locked)
        as_object_arg(tx, personal_kiosk_cap_id), // recipient_pkcap: &PersonalKioskCap (the recipient's)
        shared_object_arg(tx, network, 'ITEM_POLICY', true, a.ITEM_POLICY), // policy: &mut TransferPolicy<Item> — MUTABLE (royalty_rule::pay)
        shared_object_arg(tx, network, 'GAME_CONFIG', false, a.GAME_CONFIG), // config: &GameConfig
        shared_object_arg(tx, network, 'VERSION', false, a.VERSION), // version: &Version
      ],
    })
    return tx
  }
}

/**
 * RECALL an unclaimed gift (SENDER-only on-chain): delist every cap back into the sender's kiosk (the items
 * become `take`-able again) and refund the pre-funded royalty. Ownership-gated only — no config/version arg (a
 * refund of the sender's own items + money is never kill-switched). Consumes the gift by value.
 * @param {import("../../../types.js").Context} context
 */
export function gift_recall_ptb(context) {
  const { network } = context
  return ({ gift_id, sender_kiosk_id, tx = new Transaction() }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)
    if (!gift_id || !sender_kiosk_id)
      throw new Error(
        '[gift_recall_ptb] gift_id and sender_kiosk_id are required.',
      )
    tx.moveCall({
      target: `${a.GIFTING_PACKAGE_ID}::gift::recall`,
      arguments: [
        as_object_arg(tx, gift_id), // gift: Gift (shared, consumed by value + deleted)
        as_object_arg(tx, sender_kiosk_id), // sender_kiosk: &mut Kiosk (caps delist back here)
      ],
    })
    return tx
  }
}
