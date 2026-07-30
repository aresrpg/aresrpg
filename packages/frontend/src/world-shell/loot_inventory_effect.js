// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The settle-to-inventory EFFECT edge: await chain data, project exact receipt rows, and publish one loot
// event through the engine reducer door. `sui_session` alone derives the typed inventory input from that
// event; this async edge never writes generic store state. Account identity is captured before the await so
// a late wallet-A receipt can never enter wallet B's reducer floor.
//
// ONE event, every mint path (#265/#1488): `reduce_minted_receipt` is the shared fold+publish half. Fight settle
// (mint_and_reduce_inventory below) awaits its OWN mint first, then hands the settlement in; a lootbox claim
// (lootbox_actions.js claim_pet) already holds its receipt the instant its tx lands and calls straight in. A
// future mint door repeats the same call — never a component-level refresh, never a timer.
//
// IDENTITY (#265 recurrence, 2026-07-24): the address-match race guard reads `current_address()` — the LIVE
// wallet identity (callers inject `() => use_auth.getState().address`) — never the reducer's own state.
// The reducer used to carry a parallel `sui.selected_address`, written only by the `action/sui_login`
// dispatch that lived in embed.js's start_session(); commit 671266c2 deleted start_session wholesale
// without deleting this guard's read of the field it fed, so it sat permanently null and this door's
// dispatch silently never fired — for fight loot AND lootbox pets alike (#712 deleted the field outright).
// `use_auth` is the confirmed single source of truth for wallet identity everywhere else in this codebase.

import { settled_loot_input } from './loot_inventory.js'

/**
 * @typedef {{ get_state: () => any, dispatch: (type: string, input: any) => void }} ReducerDoor
 * @typedef {{
 *   mint_and_burn: (result_id: string, templates: string[]) => Promise<any>,
 *   load_templates: () => Promise<Map<string, any>>,
 *   reducer_door: ReducerDoor,
 *   current_address: () => string|null|undefined
 * }} LootInventoryDeps
 */

/**
 * Project an ALREADY-SETTLED mint receipt into the canonical loot event — the shared publish half every mint path
 * routes through. `owner_address` is the CALLER's pre-await snapshot, never read fresh in here: a receipt must
 * be judged against the identity that was active when its tx started, so a late wallet-A receipt can never
 * enter wallet B's reducer floor. `current_address()` is the LIVE identity read at verification time (never
 * the reducer's own state — see the file header for the #265/#712 story).
 * @param {any} settlement @param {string|null|undefined} owner_address
 * @param {{ load_templates: () => Promise<Map<string, any>>, reducer_door: ReducerDoor, current_address: () => string|null|undefined }} deps
 */
export async function reduce_minted_receipt(
  settlement,
  owner_address,
  { load_templates, reducer_door, current_address }
) {
  const input = settled_loot_input(settlement, await load_templates())
  if (owner_address && current_address() === owner_address && input.rows.length)
    reducer_door.dispatch('action/inventory/loot', { rows: input.rows })
}

/**
 * Mint+burn one result and publish its receipt rows as the canonical loot event. Only data-producing effects
 * are injectable for tests; inventory state is derived by `sui_session` when the event crosses its reducer door.
 * @param {string} result_id @param {string[]} templates @param {LootInventoryDeps} deps
 * @returns {Promise<any>} the unchanged settlement outcome for pending-mint bookkeeping
 */
export async function mint_and_reduce_inventory(
  result_id,
  templates,
  { mint_and_burn, load_templates, reducer_door, current_address }
) {
  const owner_address = current_address()
  const settlement = await mint_and_burn(result_id, templates)
  await reduce_minted_receipt(settlement, owner_address, { load_templates, reducer_door, current_address })
  return settlement
}
