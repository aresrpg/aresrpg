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

import { settled_loot_input } from './loot_inventory.js'

/**
 * @typedef {{ get_state: () => any, dispatch: (type: string, input: any) => void }} ReducerDoor
 * @typedef {{
 *   mint_and_burn: (result_id: string, templates: string[]) => Promise<any>,
 *   load_templates: () => Promise<Map<string, any>>,
 *   reducer_door: ReducerDoor
 * }} LootInventoryDeps
 */

/**
 * Fold an ALREADY-SETTLED mint receipt into the inventory reducer — the shared dispatch half every mint path
 * routes through. `owner_address` is the CALLER's pre-await snapshot, never read fresh in here: a receipt must
 * be judged against the identity that was active when its tx started, so a late wallet-A receipt can never
 * enter wallet B's reducer floor.
 * @param {any} settlement @param {string|null|undefined} owner_address
 * @param {{ load_templates: () => Promise<Map<string, any>>, reducer_door: ReducerDoor }} deps
 */
export async function reduce_minted_receipt(settlement, owner_address, { load_templates, reducer_door }) {
  const input = settled_loot_input(settlement, await load_templates())
  if (owner_address && reducer_door.get_state().sui.selected_address === owner_address && input.rows.length)
    reducer_door.dispatch('action/sui_data', input)
}

/**
 * Mint+burn one result and feed its receipt back through `action/sui_data` as a typed reducer input. Only
 * data-producing effects are injectable for tests; the reducer dispatch stays the direct production door.
 * @param {string} result_id @param {string[]} templates @param {LootInventoryDeps} deps
 * @returns {Promise<any>} the unchanged settlement outcome for pending-mint bookkeeping
 */
export async function mint_and_reduce_inventory(result_id, templates, { mint_and_burn, load_templates, reducer_door }) {
  const owner_address = reducer_door.get_state().sui.selected_address
  const settlement = await mint_and_burn(result_id, templates)
  await reduce_minted_receipt(settlement, owner_address, { load_templates, reducer_door })
  return settlement
}
