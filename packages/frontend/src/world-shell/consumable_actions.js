// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #31 — REAL on-chain consumable use against `consume::use_many` (permissionless, structural correctness via the
// player's PersonalKioskCap). Drinking a potion from the bag heals the kiosk-locked Character's missing HP.
// Mirrors equip_actions.js EXACTLY: same get_sdk() instance, same personal-kiosk resolution, same run_tx path.
// NO @server, no fake — a real self-pay tx the player signs. (The merged package's `consume::use_many` replaced
// the S-46-deleted legacy `character_health::consume_potion`; the SDK builder is sui/write/consume.js.)
//
// The Character must be IDLE (locked in the player's kiosk): while it is exploring / in a dungeon it is
// escrowed OUT of the kiosk, so `kiosk_for_character` returns null and the caller surfaces an honest error.
// The potion is a wallet-owned Item consumed PER-UNIT (D58b arity: the entry takes an `amount` — a partial
// spend splits the stack, only a fully-spent stack is burned).
//
// D307 — RAPID USE is batched: `use_consumable_batched` paints the count down INSTANTLY per click (pending
// ledger + store decrement) and a trailing ~500ms timer fires ONE tx carrying the accumulated amount. Clicks
// during a flight form the next batch. Success/failure each settle with exactly ONE toast; failure drains the
// batch's pending and refetches authoritative chain truth (D203: never arithmetic-revert), so the count
// restores. Reconciles racing an active batch can't bounce the number: load_roster's dispatch renders
// chain_amount - pending (consumable_ledger.mask_pending_items, over the reducer-owned `sui.pending_uses`).

import { create_consume_batcher } from '@aresrpg/inventory/consumable_ledger'

import { use_auth } from '../auth'
import { get_sdk } from '../chain/sdk'
import { load_roster } from '../roster/load_roster.js'
import { get_template_by_item_type_map } from '../chain/read_findables.js'
import i18n from '../i18n'
import { use_toast } from '../toast'
import { game_log } from '../core/log.js'

import { decrement_bag_items, pending_use_delta } from './store_patch.js'
import { mark_ui_updated, run_tx } from './tx.js'
// S-57 — THE ONE kiosk-resolution home (derive-from-character; never a first-cap scan). See kiosk_resolve.js.
import { kiosk_for_character } from './kiosk_resolve.js'

// potion OBJECT id → item_type SLUG, captured at CLICK time. A minted Item carries only its slug (not its
// template's object id), so the async flush resolves the shared ItemTemplate off this — and the click capture
// survives the optimistic bag-row removal (decrement_bag_items) that would otherwise drop the slug from the store.
const item_types = new Map()

/**
 * Drink `amount` units of a consumable to heal `character_id`. Returns `{ result, timing }` (run_tx) so the
 * caller reconciles the bag off the tx result + reads latency. Throws if the character isn't idle in the
 * player's kiosk. Prefer `use_consumable_batched` from UI click paths (instant paint + one tx per burst).
 * @param {{ character_id: string, potion_id: string, amount?: number }} args
 */
export async function use_consumable({ character_id, potion_id, amount = 1, item_type }) {
  const { address } = use_auth.getState()
  if (!address) throw new Error('Not connected')
  const sdk = await get_sdk()
  const handle = await kiosk_for_character(sdk, address, character_id)
  if (!handle) throw new Error('That character is busy and cannot use items right now')

  // `consume::use_many` needs the potion's shared ItemTemplate (its consumable_effect DF carries the heal
  // magnitude + required level). A minted Item exposes only its item_type slug, so resolve the template object
  // id off the memoized template catalog (item_type → template row). Slug comes from the direct arg or the
  // click-time capture; a resolution miss throws → the batch's on_failed surfaces one honest toast + refetch.
  const slug = item_type ?? item_types.get(potion_id)
  const template = slug ? (await get_template_by_item_type_map()).get(slug) : null
  if (!template?.id)
    throw new Error(`[consumable] could not resolve the potion template (item_type=${slug ?? 'unknown'})`)

  const tx = sdk.consume_potion_ptb({
    kiosk_id: handle.kiosk_id,
    personal_kiosk_cap_id: handle.personal_kiosk_cap_id,
    character_id,
    item_id: potion_id,
    template_id: template.id,
    quantity: amount,
  })
  return run_tx('use', tx)
}

// The ONE batcher instance every use surface (Inventory bag, FastSlots) clicks through — a shared home so
// bursts from different surfaces on the same potion still fold into the same batch/tx.
const batcher = create_consume_batcher({
  flush: use_consumable,
  // The optimistic delta is REDUCER state: the batcher reports, the reducer owns. A module-scoped ledger here
  // outlived `action/sui_logout` and masked the next account's stacks with this one's in-flight clicks.
  on_pending: (potion_id, units) => pending_use_delta(potion_id, units),
  on_drain: (potion_id, units) => pending_use_delta(potion_id, -units),
  on_settled: ({ timing }) => {
    mark_ui_updated(timing)
    // D9 lazy confirm — the click already painted; ONE quiet toast per BATCH (never per click), then the
    // background roster refetch reconciles HP + the bag off chain truth (masked against remaining pending).
    use_toast.getState().add(i18n.t('inventory.tx_use_success'), 'info')
    load_roster().catch(() => {})
  },
  on_failed: (error, { units }) => {
    game_log('consumable', `batched use failed (${units} units rolled back)`, error)
    // ONE toast per failed batch; the drained ledger + authoritative refetch restore the count (D203).
    use_toast.getState().add(i18n.t('inventory.tx_use_error'), 'error')
    load_roster().catch(() => {})
  },
})

/**
 * D307 — the CLICK path: instant optimistic decrement (the ×N badge drops NOW; the cell disappears on its
 * last unit) + one accumulated tx ~500ms after the last click. Callers pre-check can_consume/character
 * availability themselves (the predict-failure law) — this never refuses, it only paints and batches.
 * @param {{ character_id: string, potion_id: string, item_type?: string }} args
 */
export function use_consumable_batched({ character_id, potion_id, item_type }) {
  if (item_type) item_types.set(potion_id, item_type) // capture the slug before the optimistic row removal
  decrement_bag_items(potion_id, 1)
  batcher.click({ character_id, potion_id })
}
