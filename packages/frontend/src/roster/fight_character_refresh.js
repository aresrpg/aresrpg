// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Targeted post-fight Character refresh. The game observer supplies its store boundary as data, keeping this
// RPC adapter independent of game.js and keeping the full roster loader out of the game-module graph.

import { get_characters } from '../rpc/client'
import { game_log } from '../core/log.js'
import { reconcile_character_projection } from '../chain/fight_character_reconcile.js'

import { rpc_to_card } from './roster_projection.js'

/**
 * @param {{ character_id:string, expected_experience:number }} target
 * @param {{ get_state:()=>any, dispatch:(type:string, payload:any)=>void }} game
 * @returns {Promise<boolean>}
 */
export async function reconcile_fight_character(target, { get_state, dispatch }) {
  const reconciled = await reconcile_character_projection(target, {
    read_projection: async (character_id) => (await get_characters({ id: character_id }, undefined, true))[0] ?? null,
    read_roster: () => get_state().sui?.characters ?? [],
    write_roster: (characters) => dispatch('action/sui_data', { characters }),
    map_projection: rpc_to_card,
  })
  if (!reconciled)
    game_log('load_roster', 'post-fight Character projection did not reconcile within the bounded window', target)
  return reconciled
}
