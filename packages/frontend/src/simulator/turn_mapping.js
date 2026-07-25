// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// simulator/turn_mapping.js — spec §4.5 step 1: the drafted turn a HUD staged → the sim commands the authority
// folds. Pure; the effect edge is fight_shim.js.
//
// THE SHAPE ON THE WIRE. The production fight core stages a turn as ordered rows
// `{ kind: 0|1|2, target, spell_template_id?, spell_key? }` (`packages/fight/src/turn_commit.js stage_to_batch`)
// where `target` is a canonical stride-20 cell and kind is move / cast / weapon. That is the SAME array the real
// PTB composer reads, so mapping from it — rather than from some simulator-private draft shape — is what keeps
// the simulator's input path identical to the game's. One draft shape, two consumers.
//
// WHY MOVES NEED PATHING HERE. A staged move row is a DESTINATION (each click appends its own row — the D254
// cumulative-move rule: every drafted step ships as its own `{kind:0}` so the chain charges `bfs_path_cost` per
// segment from the running cell). The sim's `handle_move` wants the concrete cell-by-cell path instead, so each
// segment is resolved with the sim's OWN pathfinder (`find_path_4dir`) against the sim's OWN arena and
// occupancy — never a second pathfinder, and never a straight line that would disagree with what the board
// painted. Segments resolve against the RUNNING cell, so a bent multi-click path costs exactly what the chain
// charges it.
//
// NOTHING IS EVER DROPPED SILENTLY (no-silent-failure law). A row that cannot map — an unreachable waypoint, a
// cast with no template id, a weapon strike with no weapon spell — returns as a `rejected` row with a reason;
// the caller surfaces it and refuses the turn rather than committing a quietly different turn than the player
// drafted.

import { decode } from '@aresrpg/fight/los'
import { find_path_4dir } from '@aresrpg/sim/pathfind'

/** Terrain-only walkability, read exactly as the sim reads it (`reduce.js terrain_walkable`: 0 = walkable). */
const walkable_in = (arena) => (cell) =>
  cell.x >= 0 &&
  cell.y >= 0 &&
  cell.x < arena.width &&
  cell.y < arena.height &&
  arena.cells[cell.y * arena.width + cell.x] === 0

/** Every LIVING fighter except the mover — the sim blocks paths through bodies, and so must the mapping. */
const occupancy_of = (sim_state, entity_id) => {
  const taken = new Set(
    [...sim_state.team0, ...sim_state.team1]
      .filter((entity) => entity.health > 0 && entity.id !== entity_id)
      .map((entity) => `${entity.cell.x},${entity.cell.y}`)
  )
  return (cell) => taken.has(`${cell.x},${cell.y}`)
}

const cell_of = (sim_state, entity_id) =>
  [...sim_state.team0, ...sim_state.team1].find((entity) => entity.id === entity_id)?.cell ?? null

/**
 * Map ONE staged turn into ordered sim commands.
 *
 * @param {Array<{ kind:number, target:number, spell_template_id?:string }>} actions the staged draft, in order
 * @param {{ sim_state: any, arena: any, entity_id: string, weapon_spell_id?: string|null, end_turn?: boolean }} deps
 * @returns {{ commands: any[], rejected: Array<{ action: any, reason: string }> }}
 */
export const stage_to_commands = (actions, { sim_state, arena, entity_id, weapon_spell_id = null, end_turn = true }) => {
  const is_walkable = walkable_in(arena)
  const is_occupied = occupancy_of(sim_state, entity_id)
  const start = cell_of(sim_state, entity_id)
  const folded = (actions ?? []).reduce(
    (acc, action) => {
      const target = decode(Number(action.target))
      if (action.kind === 0) {
        // `find_path_4dir` returns the path INCLUSIVE of the start cell; `handle_move` wants it excluded.
        // `max_mp` is deliberately generous here: MP legality is the sim's call at fold time, not the
        // mapping's — a mapping that pre-refused on MP would be a second, drifting copy of the budget rule.
        const path = acc.cell ? find_path_4dir(acc.cell, target, arena.width * arena.height, is_walkable, is_occupied) : null
        if (!path || path.length < 2)
          return { ...acc, rejected: [...acc.rejected, { action, reason: 'unreachable' }] }
        return {
          cell: target,
          commands: [...acc.commands, { type: 'move', entity_id, path: path.slice(1) }],
          rejected: acc.rejected,
        }
      }
      const spell_id = action.kind === 2 ? weapon_spell_id : action.spell_template_id
      if (!spell_id)
        return {
          ...acc,
          rejected: [...acc.rejected, { action, reason: action.kind === 2 ? 'no_weapon_spell' : 'no_spell_template' }],
        }
      return {
        ...acc,
        commands: [...acc.commands, { type: 'cast', entity_id, spell_id, target }],
      }
    },
    { cell: start, commands: [], rejected: [] }
  )
  return {
    commands: end_turn ? [...folded.commands, { type: 'end_turn', entity_id }] : folded.commands,
    rejected: folded.rejected,
  }
}
