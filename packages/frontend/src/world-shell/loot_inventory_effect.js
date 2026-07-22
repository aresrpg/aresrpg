// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The settle-to-inventory EFFECT edge: await chain data, project one typed INPUT, dispatch it through the
// engine reducer door. The store write is direct (never a queue callback), and account identity is captured
// before the await so a late wallet-A receipt can never enter wallet B's reducer floor.

import { settled_loot_input } from './loot_inventory.js'

/**
 * @typedef {{
 *   mint_and_burn: (result_id: string, templates: string[]) => Promise<any>,
 *   load_templates: () => Promise<Map<string, any>>,
 *   reducer_door: { get_state: () => any, dispatch: (type: string, input: any) => void }
 * }} LootInventoryDeps
 */

/**
 * Mint+burn one result and feed its receipt back through `action/sui_data` as a typed reducer input. Only
 * data-producing effects are injectable for tests; the reducer dispatch stays the direct production door.
 * @param {string} result_id @param {string[]} templates @param {LootInventoryDeps} deps
 * @returns {Promise<any>} the unchanged settlement outcome for pending-mint bookkeeping
 */
export async function mint_and_reduce_inventory(result_id, templates, { mint_and_burn, load_templates, reducer_door }) {
  const owner_address = reducer_door.get_state().sui.selected_address
  const settlement = await mint_and_burn(result_id, templates)
  const input = settled_loot_input(settlement, await load_templates())
  if (owner_address && reducer_door.get_state().sui.selected_address === owner_address && input.rows.length)
    reducer_door.dispatch('action/sui_data', input)
  return settlement
}
