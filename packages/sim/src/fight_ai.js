// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Basic enemy AI: a pure turn planner the reducer runs for mob entities.
//
// SCOPE: "attack the nearest visible enemy from the CLOSEST cell inside a spell's range band, else advance toward
// it." This is the DETERMINISTIC skeleton of the on-chain §17.21 policy (`aresrpg_foundation::mob_ai::decide_turn`,
// mob_ai.move): band-aware cast positioning (`cast_cell_for`/`bfs_cast_cell`) and the monotonic reposition fallback
// (`bfs_best_toward`) — the same integer distance metric and the same (cost/dist/index) tie-breaks, so the two twins
// pick the SAME cell whenever the viable-action set has a single member (the parity regime). The chain adds a
// WEIGHTED DRAW across a multi-action set off `&Random`; this planner (offline/parity twin — the frontend never
// drives it, live mob turns are chain-rendered) stays pure and deterministic and consumes no rng.
//
// #606 fix: the old planner walked to the MIN-MANHATTAN reachable cell then cast if in range — for a min-range
// (ranged) spell that OVERSHOT into the point-blank dead zone (walked up but could never fire) and, at point-blank,
// idled. It now stops at the closest cell INSIDE the band (stepping AWAY when the target is inside min-range), so a
// mob that can reach a firing cell always fires; a mob that can't advances (strictly closer, never a lateral no-op).
//
// This planner REUSES the sim's own `get_reachable_cells` / `find_path_4dir` (pathfind.js — the Move BFS queue-order
// twin), `manhattan_distance` + `encode` (cell.js / combat_grid.js — the same cell metric + index the chain uses),
// and `can_target` (spell_targeting.js). The reducer feeds the actions back through its own move/cast handlers.

import { manhattan_distance } from './cell.js'
import { encode } from './combat_grid.js'
import { find_path_4dir, get_reachable_cells } from './pathfind.js'
import { find_entity, living_enemies } from './fight_state.js'
import { is_invisible } from './fight_statuses.js'
import { can_target } from './spell_targeting.js'

/**
 * A planned turn step (mirrors the donor FightAction union, ai/types.ts:33).
 * @typedef {{ type: 'move', path: import('./cell.js').Cell[] } | { type: 'cast', spell_id: string, target: import('./cell.js').Cell, level: number } | { type: 'end_turn' }} FightAction
 */

/**
 * The nearest living enemy by manhattan distance (deterministic tie-break: first in scan order).
 * @param {import('./fight_state.js').FightState} state
 * @param {import('./fight_state.js').FightEntity} entity
 * @returns {import('./fight_state.js').FightEntity | null}
 */
const nearest_enemy = (state, entity) => {
  // No last-known-cell state exists in the frozen fight shape: hidden enemies are unknown to AI, never
  // approached omnisciently. An empty visible list naturally yields an end-turn action below.
  const enemies = living_enemies(state, entity.id).filter(
    enemy => !is_invisible(enemy),
  )
  let best = null
  let best_dist = Infinity
  for (const enemy of enemies) {
    const dist = manhattan_distance(entity.cell, enemy.cell)
    if (dist < best_dist) {
      best_dist = dist
      best = enemy
    }
  }
  return best
}

/**
 * The most expensive (highest-AP) castable damage spell the fighter KNOWS whose AoE/range can hit `target`
 * from `from`, or null. "Castable" = AP-affordable and target legal (range/LoS/linear) via can_target.
 * @param {import('./fight_state.js').FightState} state
 * @param {import('./fight_state.js').FightEntity} entity
 * @param {import('./cell.js').Cell} from
 * @param {import('./cell.js').Cell} target
 * @param {Map<string, import('./spell_templates.js').SpellTemplate>} spell_templates
 * @param {import('./spell_targeting.js').TargetingContext} context
 * @returns {{ spell_id: string, level: number } | null}
 */
const best_castable_damage_spell = (
  state,
  entity,
  from,
  target,
  spell_templates,
  context,
) => {
  const range_bonus = entity.stats.range ?? 0
  let best = null
  let best_cost = -1
  for (const spell_id of Object.keys(entity.spell_levels)) {
    const template = spell_templates.get(spell_id)
    if (!template) continue
    const level = entity.spell_levels[spell_id] ?? 1
    const spell_level = template.levels[level - 1]
    if (!spell_level) continue
    if (spell_level.cost > entity.ap) continue
    const is_damage = spell_level.base_effects.some(
      e => e.type === 'DAMAGE' || e.type === 'STEAL',
    )
    if (!is_damage) continue
    if (!can_target(spell_level, from, target, context, range_bonus)) continue
    if (spell_level.cost > best_cost) {
      best_cost = spell_level.cost
      best = { spell_id, level }
    }
  }
  return best
}

/**
 * The CLOSEST reachable cell a damage spell can strike `target` from — the sim twin of Move's `cast_cell_for` /
 * `combat_grid::bfs_cast_cell`. Over every reachable cell (incl. the mob's own cell at cost 0 = strike from
 * standing), keep the one minimizing (MP cost, then manhattan distance to target, then cell index — byte-identical
 * to the chain's tie-break). Returns `{ cell, cost, spell_id, level }` or null when no reachable cell can cast.
 * A min-range spell thus HOLDS at its band (stepping away from a point-blank target) instead of overshooting.
 * @param {import('./fight_state.js').FightState} state
 * @param {import('./fight_state.js').FightEntity} entity
 * @param {import('./cell.js').Cell} target
 * @param {import('./pathfind.js').Reachable[]} reachable
 * @param {Map<string, import('./spell_templates.js').SpellTemplate>} spell_templates
 * @param {import('./spell_targeting.js').TargetingContext} context
 * @returns {{ cell: import('./cell.js').Cell, cost: number, spell_id: string, level: number } | null}
 */
const closest_cast_cell = (
  state,
  entity,
  target,
  reachable,
  spell_templates,
  context,
) => {
  let best = null
  let best_cost = Infinity
  let best_dist = Infinity
  let best_idx = Infinity
  for (const { cell, cost } of reachable) {
    const cast = best_castable_damage_spell(
      state,
      entity,
      cell,
      target,
      spell_templates,
      context,
    )
    if (!cast) continue
    const dist = manhattan_distance(cell, target)
    const idx = encode(cell.x, cell.y)
    if (
      cost < best_cost ||
      (cost === best_cost && dist < best_dist) ||
      (cost === best_cost && dist === best_dist && idx < best_idx)
    ) {
      best = { cell, cost, spell_id: cast.spell_id, level: cast.level }
      best_cost = cost
      best_dist = dist
      best_idx = idx
    }
  }
  return best
}

/**
 * The cell to advance to when NO cast is reachable — the sim twin of `combat_grid::bfs_best_toward`. Over every
 * reachable cell that is NOT the target's own cell (stop adjacent), keep the one minimizing (manhattan distance to
 * target, then MP cost, then cell index). `start` is the cost-0 seed (the mob holds if it is already at the local
 * minimum), so the chosen cell is NEVER farther from the target than the mob started — MP is spent only to CLOSE.
 * @param {import('./cell.js').Cell} start
 * @param {import('./cell.js').Cell} target
 * @param {import('./pathfind.js').Reachable[]} reachable
 * @returns {import('./cell.js').Cell}
 */
const best_toward = (start, target, reachable) => {
  let best = start
  let best_dist = manhattan_distance(start, target)
  let best_cost = 0
  let best_idx = encode(start.x, start.y)
  for (const { cell, cost } of reachable) {
    if (cell.x === target.x && cell.y === target.y) continue
    const dist = manhattan_distance(cell, target)
    const idx = encode(cell.x, cell.y)
    if (
      dist < best_dist ||
      (dist === best_dist && cost < best_cost) ||
      (dist === best_dist && cost === best_cost && idx < best_idx)
    ) {
      best = cell
      best_dist = dist
      best_cost = cost
      best_idx = idx
    }
  }
  return best
}

/**
 * Plan a mob's turn: strike the nearest enemy from the closest reachable band cell (moving there first if needed),
 * else advance toward it, else end turn. Returns an ordered action list for the reducer to execute.
 *
 * @param {import('./fight_state.js').FightState} state
 * @param {string} entity_id
 * @param {Map<string, import('./spell_templates.js').SpellTemplate>} spell_templates
 * @param {(cell: import('./cell.js').Cell) => boolean} is_walkable terrain walkability
 * @param {(cell: import('./cell.js').Cell) => boolean} is_occupied living-body occupancy, excluding the mover
 * @param {import('./spell_targeting.js').TargetingContext} context
 * @returns {FightAction[]}
 */
export const ai_choose_turn = (
  state,
  entity_id,
  spell_templates,
  is_walkable,
  is_occupied,
  context,
) => {
  const entity = find_entity(state, entity_id)
  if (!entity) return [{ type: 'end_turn' }]

  const target = nearest_enemy(state, entity)
  if (!target) return [{ type: 'end_turn' }]

  // Cells reachable within MP (4-dir BFS — the Move `bfs_*` queue-discipline twin), including the mob's own cell.
  const reachable = get_reachable_cells(
    entity.cell,
    entity.mp,
    is_walkable,
    is_occupied,
  )

  // 1. ATTACK: strike from the CLOSEST reachable band cell. cost 0 = strike from standing (attack-now); cost > 0 =
  //    advance exactly to that cast cell then strike (attack-move, no wasted MP). Band-aware, so a min-range spell
  //    steps to its band instead of walking into the point-blank dead zone (#606).
  const cast_plan = closest_cast_cell(
    state,
    entity,
    target.cell,
    reachable,
    spell_templates,
    context,
  )
  if (cast_plan) {
    const cast_action = /** @type {FightAction} */ ({
      type: 'cast',
      spell_id: cast_plan.spell_id,
      target: target.cell,
      level: cast_plan.level,
    })
    if (cast_plan.cost === 0) return [cast_action]
    const path = find_path_4dir(
      entity.cell,
      cast_plan.cell,
      entity.mp,
      is_walkable,
      is_occupied,
    )
    if (path) return [{ type: 'move', path }, cast_action]
  }

  // 2. REPOSITION: no reachable cast cell → a single advance toward the target, monotonic (never ends farther —
  //    MP spent only to close for next turn). Mirrors the on-chain reposition fallback.
  const goal = best_toward(entity.cell, target.cell, reachable)
  if (goal.x !== entity.cell.x || goal.y !== entity.cell.y) {
    const path = find_path_4dir(
      entity.cell,
      goal,
      entity.mp,
      is_walkable,
      is_occupied,
    )
    if (path) return [{ type: 'move', path }]
  }

  return [{ type: 'end_turn' }]
}
