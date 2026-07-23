// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  aresrpg_deployment,
  shared_object_arg,
} from '../../deployment/aresrpg.js'
import { as_object_arg } from '../object_arg.js'

import { split_locked_stack_id } from './item_stacks.js'
import { new_ptb } from './header.js'

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
 * makes the gift free to receive. Alternatively, pass `item_transfers` with an amount and available_amount for
 * each item; partial stacks are split and the returned locked-stack IDs are gifted atomically. Funds off the
 * STAMPED floor `number of resulting items × a.ITEM_ROYALTY_MIN_MIST` —
 * REFUSES loudly if that stamp is missing/zero (never build a gift off a blank floor) or an explicit
 * `royalty_mist` is below it — an under-funded gift would be silently UNCLAIMABLE (the claim's escrow split
 * aborts). Omit `royalty_mist` to fund exactly the stamped floor; pass a higher value to over-fund (surplus
 * refunds at claim). The royalty coin is split EXACTLY off gas. The chain aborts `EEmptyGift` on an empty list;
 * `list_with_purchase_cap` aborts if an item is already listed.
 * @param {import("../../../types.js").Context} context
 */
export function gift_send_ptb(context) {
  const { network } = context
  const split_locked_stack = split_locked_stack_id(context)
  return ({
    kiosk_id,
    personal_kiosk_cap_id,
    item_ids,
    item_transfers,
    recipient,
    royalty_mist,
    tx = new_ptb(context.network, context.ids?.aresrpg),
  }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)
    if (!kiosk_id || !personal_kiosk_cap_id || !recipient)
      throw new Error(
        '[gift_send_ptb] kiosk_id, personal_kiosk_cap_id and recipient are required.',
      )

    const has_item_transfers = item_transfers !== undefined
    if (has_item_transfers && item_ids !== undefined)
      throw new Error(
        '[gift_send_ptb] provide either item_ids or item_transfers, not both.',
      )

    let transfers
    if (has_item_transfers) {
      if (!Array.isArray(item_transfers) || item_transfers.length === 0)
        throw new Error(
          '[gift_send_ptb] item_transfers must be a non-empty array.',
        )

      const seen = new Set()
      transfers = item_transfers.map((transfer, index) => {
        if (!transfer || typeof transfer !== 'object' || !transfer.item_id)
          throw new Error(
            `[gift_send_ptb] item_transfers[${index}].item_id is required.`,
          )
        if (seen.has(transfer.item_id))
          throw new Error(
            `[gift_send_ptb] duplicate item_id ${transfer.item_id} in item_transfers.`,
          )
        seen.add(transfer.item_id)

        let amount
        let available_amount
        try {
          amount = BigInt(transfer.amount)
          available_amount = BigInt(transfer.available_amount)
        } catch {
          throw new Error(
            `[gift_send_ptb] item_transfers[${index}] amount and available_amount must be integers.`,
          )
        }
        if (amount < 1n)
          throw new Error(
            `[gift_send_ptb] item_transfers[${index}].amount must be >= 1.`,
          )
        if (available_amount < 1n)
          throw new Error(
            `[gift_send_ptb] item_transfers[${index}].available_amount must be >= 1.`,
          )
        if (amount > available_amount)
          throw new Error(
            `[gift_send_ptb] item_transfers[${index}].amount exceeds available_amount.`,
          )
        return {
          item_id: transfer.item_id,
          amount,
          available_amount,
        }
      })
    } else if (!Array.isArray(item_ids) || item_ids.length === 0) {
      throw new Error(
        '[gift_send_ptb] item_ids must be a non-empty array of kiosk-locked item ids.',
      )
    }

    const send_item_ids = transfers
      ? transfers.map(transfer => transfer.item_id)
      : item_ids

    // The STAMPED royalty floor (never a chain read here — see the DRIFT POSTURE header note). Missing/zero
    // means an un-stamped network: refuse rather than build a gift that could be free (or unclaimable at 0).
    if (!a.ITEM_ROYALTY_MIN_MIST || BigInt(a.ITEM_ROYALTY_MIN_MIST) <= 0n)
      throw new Error(
        '[gift_send_ptb] ITEM_ROYALTY_MIN_MIST is not stamped in release.json for this network — run the publish/upgrade ceremony before composing a gift.',
      )
    const min_mist = BigInt(a.ITEM_ROYALTY_MIN_MIST)
    const floor = min_mist * BigInt(send_item_ids.length)
    const funded = royalty_mist == null ? floor : BigInt(royalty_mist)
    if (funded < floor)
      throw new Error(
        `[gift_send_ptb] royalty_mist ${funded} is below the stamped floor ${floor} (${send_item_ids.length} items × ${min_mist} ITEM_ROYALTY_MIN_MIST) — an under-funded gift is unclaimable.`,
      )

    const [royalty] = tx.splitCoins(tx.gas, [tx.pure.u64(funded)])
    const has_partial_stack = transfers?.some(
      ({ amount, available_amount }) => amount < available_amount,
    )
    /** @type {import('@mysten/sui/transactions').TransactionArgument} */
    let composed_item_ids
    if (has_partial_stack) {
      const transfer_ids = transfers.map(
        ({ item_id, amount, available_amount }) => {
          if (amount === available_amount) return tx.pure.id(item_id)
          const [split_item_id] = split_locked_stack({
            kiosk_id,
            personal_kiosk_cap_id,
            item_id,
            amount,
            tx,
          })
          return split_item_id
        },
      )

      // MakeMoveVec is object-only in Sui, whereas split_locked_stack returns the value type object::ID. Build
      // the mixed pure/result ID vector with the framework's generic vector functions instead.
      const [first_id, ...remaining_ids] = transfer_ids
      const [dynamic_item_ids] = tx.moveCall({
        target: '0x1::vector::singleton',
        typeArguments: ['0x2::object::ID'],
        arguments: [first_id],
      })
      for (const item_id of remaining_ids)
        tx.moveCall({
          target: '0x1::vector::push_back',
          typeArguments: ['0x2::object::ID'],
          arguments: [dynamic_item_ids, item_id],
        })
      composed_item_ids = dynamic_item_ids
    } else composed_item_ids = tx.pure.vector('id', send_item_ids)

    tx.moveCall({
      target: `${a.GIFTING_PACKAGE_ID}::gift::send`,
      arguments: [
        as_object_arg(tx, kiosk_id), // kiosk: &mut Kiosk (the sender's)
        as_object_arg(tx, personal_kiosk_cap_id), // pkcap: &PersonalKioskCap (the sender's)
        composed_item_ids, // item_ids: vector<ID>
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
    tx = new_ptb(context.network, context.ids?.aresrpg),
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
  return ({
    gift_id,
    sender_kiosk_id,
    tx = new_ptb(context.network, context.ids?.aresrpg),
  }) => {
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
