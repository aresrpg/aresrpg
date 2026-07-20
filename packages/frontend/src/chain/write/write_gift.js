// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// GIFT + AIRDROP on-chain WRITES — chain-direct (no server) PTB submits for the escrow-recoverable item SEND,
// the receiver CLAIM / sender RECALL, and the whitelist airdrop CLAIM. The ONE frontend home wiring the frozen
// @aresrpg/sdk composers (gift_send_ptb / gift_claim_ptb / gift_recall_ptb / airdrop_claim_ptb — read-only to
// this lane) to the kiosk-cap resolution and the tx choke. Mirrors write_listings.js idioms (get_sdk +
// kiosk_cap_cache.get_personal_cap + the run_tx pipeline).
//
// MONEY ROUTING (anti-drain law — the SAME split-off-gas class as the &Random shop buys):
//   • SEND  → run_tx_random (keep_budget = SELF-PAY, sponsor EXCLUDED). gift_send_ptb splits the pre-funded
//             royalty coin off tx.gas exactly like buy_ptb splits the item price — a sponsored gas coin would
//             pay the royalty (a drain). The sender pre-funds the royalty from their OWN coin, always.
//   • CLAIM / RECALL / AIRDROP → run_tx (sponsor-first eligible). These are PURE-GAS: claim pays the royalty
//             from the ESCROWED balance (free to the receiver), recall refunds the sender, and an airdrop is a
//             mint-lock (a first acquisition — NO royalty). No value is split off gas ⇒ a sponsored gas coin is
//             safe, and the free-to-receive promise wants the claim gas sponsored.
//
// PRE-PUBLISH: the gift/airdrop Move modules ride the pending fresh publish (DECISIONS 2026-07-13 21:3x), so a
// real submit dry-run-REFUSES at the choke (the module isn't on-chain yet) — one honest humanized toast, zero
// gas. The exact same code goes live at publish with no frontend change (the SDK's stamp-or-throw deployment
// home + the choke's simulate-refuse gate carry the whole pre/post-publish seam).

import { aresrpg_id } from '@aresrpg/sdk/deployment/aresrpg'

import { use_auth } from '../../auth'
import { run_tx, run_tx_random } from '../../world-shell/tx'
import { get_sdk } from '../sdk'
import { DEMO_NETWORK } from '../deployment'
import { get_personal_cap } from '../kiosk_cap_cache'

/**
 * The Item TransferPolicy's royalty_rule `min_amount` (MIST) for the DISPLAY of the pre-funded escrow (N ×
 * this) — the STAMPED constant (baked in at ceremony/stamp time like every other
 * deployment id, `packages/sdk/src/deployment/aresrpg.js` ITEM_ROYALTY_MIN_MIST), never a runtime chain read.
 * The actual money is derived the SAME way inside gift_send_ptb, so the two can never drift. Returns null when
 * unstamped (pre-publish) so the review renders a neutral "prepaid by sender" note instead of a wrong number —
 * never throws (this is a display pre-flight, not the money path — gift_send_ptb is the one that refuses loudly).
 * @returns {Promise<bigint | null>}
 */
export async function item_royalty_min_mist() {
  const min_mist = aresrpg_id(DEMO_NETWORK, 'ITEM_ROYALTY_MIN_MIST')
  return min_mist ? BigInt(min_mist) : null
}

/**
 * SEND `item_ids` (all kiosk-locked in the sender's `kiosk_id`) to `recipient`, pre-funding the royalty escrow.
 * SELF-PAY (run_tx_random / keep_budget) — see the money-routing header. gift_send_ptb funds off the STAMPED
 * royalty floor and REFUSES loudly if it's unstamped/zero, so an under-funded (unclaimable) gift can never be
 * composed. Throws a humanized error the caller surfaces (never auto-retried — tx-retry law).
 * @param {{ item_ids: string[], kiosk_id: string, recipient: string }} args
 * @returns {Promise<{ digest: string }>}
 */
export async function send_gift({ item_ids, kiosk_id, recipient }) {
  const sdk = await get_sdk()
  const { address } = use_auth.getState()
  if (!address) throw new Error('Not signed in')
  const cap = await get_personal_cap(sdk, address, kiosk_id)
  if (!cap) throw new Error('No kiosk holds these items')

  const tx = await sdk.gift_send_ptb({
    kiosk_id: cap.kioskId,
    personal_kiosk_cap_id: cap.objectId,
    item_ids,
    recipient,
  })
  const { result } = await run_tx_random('gift_send', tx, undefined, { sponsor_excluded: true }) // splits the royalty off tx.gas → self-pay only
  return { digest: result?.digest ?? '' }
}

/**
 * CLAIM a gift (receiver): consume the escrow, buy each item out of the SENDER's kiosk for 0, pay the royalty
 * from the escrow, land the items LOCKED in the receiver's own kiosk. PURE-GAS (sponsorable — run_tx). The
 * receiver's kiosk + cap are resolved from their own address; a wallet with NO personal kiosk cannot claim
 * (the frozen SDK claim requires an existing kiosk) — surfaced honestly to the caller.
 * @param {{ gift_id: string, sender_kiosk_id: string }} args
 * @returns {Promise<{ digest: string }>}
 */
export async function claim_gift({ gift_id, sender_kiosk_id }) {
  const sdk = await get_sdk()
  const { address } = use_auth.getState()
  if (!address) throw new Error('Not signed in')
  const cap = await get_personal_cap(sdk, address)
  if (!cap) throw new Error('NO_KIOSK')

  // sender_kiosk_id is read off the gift's caps when the inbox row doesn't carry it (chain-direct pre-flight).
  let sender_kiosk = sender_kiosk_id
  if (!sender_kiosk) {
    const gift = await sdk.get_gift(gift_id)
    sender_kiosk = gift?.sender_kiosk_id ?? null
    if (!sender_kiosk) throw new Error('Gift not found')
  }

  const tx = sdk.gift_claim_ptb({
    gift_id,
    sender_kiosk_id: sender_kiosk,
    recipient_kiosk_id: cap.kioskId,
    personal_kiosk_cap_id: cap.objectId,
  })
  const { result } = await run_tx('gift_claim', tx)
  return { digest: result?.digest ?? '' }
}

/**
 * RECALL an unclaimed gift (sender-only on-chain): delist every cap back into the sender's kiosk + refund the
 * pre-funded royalty. PURE-GAS (sponsorable — run_tx). Ownership-gated by the Move module.
 * @param {{ gift_id: string, sender_kiosk_id: string }} args
 * @returns {Promise<{ digest: string }>}
 */
export async function recall_gift({ gift_id, sender_kiosk_id }) {
  const sdk = await get_sdk()
  const { address } = use_auth.getState()
  if (!address) throw new Error('Not signed in')

  let sender_kiosk = sender_kiosk_id
  if (!sender_kiosk) {
    const cap = await get_personal_cap(sdk, address)
    sender_kiosk = cap?.kioskId ?? null
    if (!sender_kiosk) throw new Error('No kiosk holds this gift')
  }

  const tx = sdk.gift_recall_ptb({ gift_id, sender_kiosk_id: sender_kiosk })
  const { result } = await run_tx('gift_recall', tx)
  return { digest: result?.digest ?? '' }
}

/**
 * CLAIM an airdrop (whitelisted signer): mint ONE reserved item into the signer's OWN personal kiosk,
 * kiosk-locked (mint-lock — no royalty, none bypassed). PURE-GAS (sponsorable — run_tx). The claim REMOVES the
 * signer from the whitelist on-chain (one claim per address by construction). A wallet with no personal kiosk
 * cannot claim (the frozen SDK claim requires an existing kiosk) — surfaced honestly.
 * @param {{ airdrop_id: string, template_id: string }} args
 * @returns {Promise<{ digest: string }>}
 */
export async function claim_airdrop({ airdrop_id, template_id }) {
  const sdk = await get_sdk()
  const { address } = use_auth.getState()
  if (!address) throw new Error('Not signed in')
  const cap = await get_personal_cap(sdk, address)
  if (!cap) throw new Error('NO_KIOSK')

  const tx = sdk.airdrop_claim_ptb({
    airdrop_id,
    template_id,
    kiosk_id: cap.kioskId,
    personal_kiosk_cap_id: cap.objectId,
  })
  const { result } = await run_tx('airdrop_claim', tx)
  return { digest: result?.digest ?? '' }
}
