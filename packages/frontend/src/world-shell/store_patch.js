// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #39 — direct engine-store (s.sui) patches from a tx's OWN result: the "reconcile" half of predict+reconcile.
// Instead of a blocking full chain refetch (load_roster) after every tx, apply the objects the tx already
// returned to the bag slice so the UI updates instantly; the load_roster background poll stays the safety net.
//
// M5 (audit row #3): these were READ-MODIFY-WRITEs (dispatch { items: bag().filter(...) }) — reading the bag at
// CALL time, so a snapshot that reduced in between was clobbered by the stale-captured array (the lost-update
// race). Now each dispatches a TYPED receipt_patch DELTA; the sui_session reducer folds it against the LATEST
// bag. Same exported signatures — callers (Inventory equip, shop buy, consume) are untouched.

import { add_pending_buy } from '@aresrpg/inventory/bought_items_ledger'

import { context } from '../game/core/game.js'

// (#55 note: the old `bump_character_spell` roster patch died with the S-46 spell model — per-spell levels are
// namespaced DFs on the Character now, held panel-local in Spellbook.jsx via read_spell_state.js, never
// roster-character fields.)

/** Drop `ids` from the bag (e.g. items just equipped into a character / consumed). */
export function remove_bag_items(/** @type {string[]} */ ids) {
  if (!ids?.length) return
  context.dispatch('action/sui_data', { kind: 'receipt_patch', op: 'remove_items', ids })
}

/** Add `new_items` to the bag (e.g. items just unequipped), de-duped by id (in the reducer). */
export function add_bag_items(/** @type {any[]} */ new_items) {
  if (!new_items?.length) return
  context.dispatch('action/sui_data', { kind: 'receipt_patch', op: 'add_items', rows: new_items })
}

/**
 * Optimistically PAINT just-bought items into the bag NOW (predict) + register them in the bought-item ledger
 * so load_roster's full-replace reconcile PRESERVES them until the /v1 owner-items view catches up (the
 * indexer lags a kiosk-locking buy — "the just-bought key took ages to show"). Rows carry the REAL created
 * object ids (from the buy tx effects), so each self-drains the instant a chain read includes its id. Called
 * ONLY on buy SUCCESS (a failed/pre-exec buy throws first → nothing injected → no false paint, never a retry).
 * @param {any[]} rows  bag-shaped rows ({ id, item_type, item_category, name, amount, kiosk_id, kiosk_cap_id })
 */
export function hydrate_bought_items(/** @type {any[]} */ rows) {
  if (!rows?.length) return
  for (const row of rows) add_pending_buy(row)
  add_bag_items(rows)
}

/**
 * D307 — spend `units` off a STACKED bag row (per-unit consumable use): decrement its amount, and REMOVE the
 * row when it reaches 0 (the cell disappears the same update — D307c ties the tooltip to that removal). The
 * per-unit twin of remove_bag_items; snapshot reconcile stays masked (consumable_ledger, now in the reducer).
 */
export function decrement_bag_items(/** @type {string} */ id, units = 1) {
  context.dispatch('action/sui_data', { kind: 'receipt_patch', op: 'decrement_item', id, units })
}

/**
 * #1495 — fold the boot sweep's PROVEN stack merges: each `from` was deleted on chain, the surviving `into`
 * carries the summed `total`. Receipt-only by construction (chain/stack_merge.js reads the ItemMerged events),
 * so a failed or partial merge paints nothing.
 * @param {{ into: string, from: string, total: number }[]} merges
 */
export function apply_stack_merge_receipt(merges) {
  if (!merges?.length) return
  context.dispatch('action/sui_data', { kind: 'receipt_patch', op: 'merge_stacks', merges })
}

/**
 * Project a SIGNED equip tx's cosmetic-slot transition onto the character row now (the world rig re-dresses
 * this frame — client-independence §1; the rig projects `characters[i].worn` per frame and had no writer
 * besides the laggy /v1 reconcile). reconcile_equip_state's confirmed row adopts chain truth right after.
 * @param {string} character_id
 * @param {{ set?: Record<string, { item_id: string, template_id: string|null, category: string }>, clear?: string[] }} change
 */
export function apply_worn_receipt(character_id, { set = {}, clear = [] } = {}) {
  if (!character_id || (!Object.keys(set).length && !clear.length)) return
  context.dispatch('action/sui_data', { kind: 'receipt_patch', op: 'equip_worn', character_id, set, clear })
}
