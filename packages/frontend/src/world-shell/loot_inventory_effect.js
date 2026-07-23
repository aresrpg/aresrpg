// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The settle-to-inventory EFFECT edge: await chain data, project one typed INPUT, dispatch it through the
// engine reducer door. The store write is direct (never a queue callback), and account identity is captured
// before the await so a late wallet-A receipt can never enter wallet B's reducer floor.
//
// ONE door, every mint path (#265): `reduce_minted_receipt` is the shared fold+dispatch half. Fight settle
// (mint_and_reduce_inventory below) awaits its OWN mint first, then hands the settlement in; a lootbox claim
// (lootbox_actions.js claim_pet) already holds its receipt the instant its tx lands and calls straight in. A
// future mint door repeats the same call — never a component-level refresh, never a timer.
//
// IDENTITY (#265 recurrence, 2026-07-24): the owner-match race guard reads `current_address()` — the LIVE
// wallet identity (callers inject `() => use_auth.getState().address`) — NEVER `reducer_door`'s
// `sui.selected_address`. That engine field is only ever written by the `action/sui_login` dispatch that
// used to live in embed.js's start_session(); commit 671266c2 deleted start_session wholesale (the old
// WebSocket "online" server model) without deleting this guard's read of the field it fed. From that commit
// on, `sui.selected_address` sat permanently null, so `owner_address && ...` was always false and this
// door's dispatch silently never fired — for fight loot AND lootbox pets alike. `use_auth` is the confirmed
// single source of truth for wallet identity everywhere else in this codebase.

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
 * Fold an ALREADY-SETTLED mint receipt into the inventory reducer — the shared dispatch half every mint path
 * routes through. `owner_address` is the CALLER's pre-await snapshot, never read fresh in here: a receipt must
 * be judged against the identity that was active when its tx started, so a late wallet-A receipt can never
 * enter wallet B's reducer floor. `current_address()` is the LIVE identity read at verification time (never
 * `reducer_door`'s `sui.selected_address` — see the file header for why that field is dead).
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
    reducer_door.dispatch('action/sui_data', input)
}

/**
 * Mint+burn one result and feed its receipt back through `action/sui_data` as a typed reducer input. Only
 * data-producing effects are injectable for tests; the reducer dispatch stays the direct production door.
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
