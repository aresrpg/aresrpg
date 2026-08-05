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
// twin), `manhattan` + `encode` (combat_grid.js — the same cell metric + index the chain uses),
// and `can_target` (spell_targeting.js). The reducer feeds the actions back through its own move/cast handlers.

import { encode, manhattan } from './combat_grid.js'
import { find_path_4dir, get_reachable_cells } from './pathfind.js'
import { find_entity, living_enemies, team_of } from './fight_state.js'
import { is_invisible } from './fight_statuses.js'
import { can_target } from './spell_targeting.js'
import { check_cast_limits } from './fight_cast_limits.js'

/**
 * A planned turn step (mirrors the donor FightAction union, ai/types.ts:33).
 * @typedef {{ type: 'move', path: import('./cell.js').Cell[] } | { type: 'cast', spell_id: string, target: import('./cell.js').Cell, level: number } | { type: 'end_turn' }} FightAction
 */

/**
 * #1874 — one line of the planner's reasoning. `target` names who it is playing against, `cast` names a spell
 * that was refused everywhere the mob could stand (and why), `plan` names the turn it settled on. See
 * `ai_explain_turn`.
 * @typedef {{ phase: 'target', chose: string|null, why: string }
 *   | { phase: 'cast', spell_id: string|null, refused: string[], cells_tried: number }
 *   | { phase: 'plan', chose: 'cast'|'move+cast'|'move'|'pass', why: string }} TraceRow
 */

/**
 * The nearest living enemy by manhattan distance (deterministic tie-break: first in scan order).
 * @param {import('./fight_state.js').FightState} state
 * @param {import('./fight_state.js').FightEntity} entity
 * @returns {import('./fight_state.js').FightEntity | null}
 */
const nearest_enemy = (state, entity) => {
  // No last-known-cell state exists in the frozen fight shape: hidden enemies are unknown to AI, never
  // approached omnisciently. An empty visible list sends the planner to the SEARCH WALK below.
  const enemies = living_enemies(state, entity.id).filter(
    enemy => !is_invisible(enemy),
  )
  let best = null
  let best_dist = Infinity
  for (const enemy of enemies) {
    const dist = manhattan(entity.cell, enemy.cell)
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
 * @param {((spell_id: string, reason: string) => void)|null} [refused]  the refusal sink (#1874): called for
 *   every spell this cell could NOT cast, with the reason it was dropped. Absent ⇒ nothing is recorded and the
 *   decision is byte-identical (the planner is on the reducer's hot path; the instrument is opt-in).
 * @returns {{ spell_id: string, level: number } | null}
 */
const best_castable_damage_spell = (
  state,
  entity,
  from,
  target,
  spell_templates,
  context,
  refused = null,
) => {
  const range_bonus = entity.stats.range ?? 0
  const drop = (spell_id, reason) => {
    refused?.(spell_id, reason)
    return null
  }
  let best = null
  let best_cost = -1
  for (const spell_id of Object.keys(entity.spell_levels)) {
    const template = spell_templates.get(spell_id)
    if (!template) {
      drop(spell_id, 'no_template')
      continue
    }
    const level = entity.spell_levels[spell_id] ?? 1
    const spell_level = template.levels[level - 1]
    if (!spell_level) {
      drop(spell_id, 'no_such_level')
      continue
    }
    if (spell_level.cost > entity.ap) {
      drop(spell_id, 'ap')
      continue
    }
    const is_damage = spell_level.base_effects.some(
      e => e.type === 'DAMAGE' || e.type === 'STEAL',
    )
    if (!is_damage) {
      drop(spell_id, 'not_a_damage_spell')
      continue
    }
    if (
      !can_target(
        spell_level,
        from,
        target,
        {
          ...context,
          target_cap_reached: cell =>
            check_cast_limits(state, entity.id, spell_id, spell_level, cell)
              .error === 'CASTS_PER_TARGET',
        },
        range_bonus,
      )
    ) {
      drop(spell_id, 'cannot_target_from_here')
      continue
    }
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
 * @param {{ spell_id: string, refused: string[], cells_tried: number }[]|null} [refusals]  filled (#1874) with
 *   ONE row per spell that was refused everywhere, carrying every distinct reason and how many cells were tried.
 * @returns {{ cell: import('./cell.js').Cell, cost: number, spell_id: string, level: number } | null}
 */
const closest_cast_cell = (
  state,
  entity,
  target,
  reachable,
  spell_templates,
  context,
  refusals = null,
) => {
  // One row per SPELL, not per (spell, cell): "bite was refused at all 12 cells I could stand on, for AP" is the
  // answer a reader needs; twelve identical rows are noise. `castable` un-refuses a spell that worked somewhere.
  const reasons = refusals ? new Map() : null
  const castable = refusals ? new Set() : null
  const sink = refusals
    ? (spell_id, reason) => {
        const row = reasons.get(spell_id) ?? {
          refused: new Set(),
          cells_tried: 0,
        }
        row.refused.add(reason)
        row.cells_tried += 1
        reasons.set(spell_id, row)
      }
    : null
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
      sink,
    )
    if (cast) castable?.add(cast.spell_id)
    if (!cast) continue
    const dist = manhattan(cell, target)
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
  if (refusals)
    for (const [spell_id, row] of reasons)
      if (!castable.has(spell_id))
        refusals.push({
          spell_id,
          refused: [...row.refused],
          cells_tried: row.cells_tried,
        })
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
  let best_dist = manhattan(start, target)
  let best_cost = 0
  let best_idx = encode(start.x, start.y)
  for (const { cell, cost } of reachable) {
    if (cell.x === target.x && cell.y === target.y) continue
    const dist = manhattan(cell, target)
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
 * THE SEARCH LANDMARK (#1061) — the goal a BLINDED fighter walks toward when every opponent is invisible: its OWN
 * side's spawn anchor (team 0 → `team0_cells[0]`, team 1 → `team1_cells[0]`; for a mob that is the pole opposite
 * the players' start zone — it falls back toward home ground). Fixed board geometry, decided at fight creation,
 * so the walk consumes ZERO information about where the hidden enemies are: the sealed property that hidden cells
 * never enter AI input holds by construction. Stateless — nothing is remembered between turns.
 * MOVE TWIN: `turns.move::search_anchor` — `fight::start_cells_b[0]`, same rule.
 * @param {import('./fight_state.js').FightState} state
 * @param {import('./fight_state.js').FightEntity} entity
 * @returns {import('./cell.js').Cell | null}
 */
const search_anchor = (state, entity) => {
  const home =
    team_of(state, entity.id) === 0 ? state.team0_cells : state.team1_cells
  return home?.[0] ?? null
}

/**
 * Plan a mob's turn: strike the nearest enemy from the closest reachable band cell (moving there first if needed),
 * else advance toward it; with NO visible enemy at all, walk toward the search landmark instead of passing
 * (#1061 — invisibility buys repositioning pressure, never a free turn). Returns an ordered action list.
 *
 * @param {import('./fight_state.js').FightState} state
 * @param {string} entity_id
 * @param {Map<string, import('./spell_templates.js').SpellTemplate>} spell_templates
 * @param {(cell: import('./cell.js').Cell) => boolean} is_walkable terrain walkability
 * @param {(cell: import('./cell.js').Cell) => boolean} is_occupied living-body occupancy, excluding the mover
 * @param {import('./spell_targeting.js').TargetingContext} context
 * @param {TraceRow[]|null} [trace]  an optional sink (#1874) the planner narrates its turn into (see
 *   `ai_explain_turn`). Absent ⇒ nothing is recorded and the decision path is byte-identical.
 * @returns {FightAction[]}
 */
export const ai_choose_turn = (
  state,
  entity_id,
  spell_templates,
  is_walkable,
  is_occupied,
  context,
  trace = null,
) => {
  // `say` closes over the ONE trace array so every exit — including the early ones — narrates itself. A pass
  // that leaves through a branch with no `say` is exactly the silent refusal #1874 convicted.
  const say = row => trace?.push(row)
  const entity = find_entity(state, entity_id)
  if (!entity) {
    say({ phase: 'plan', chose: 'pass', why: 'no such fighter in this fight' })
    return [{ type: 'end_turn' }]
  }

  const target = nearest_enemy(state, entity)
  say({
    phase: 'target',
    chose: target?.id ?? null,
    why: target
      ? `nearest visible enemy at manhattan ${manhattan(entity.cell, target.cell)}`
      : 'no visible enemy — every opponent is dead or invisible',
  })

  // Cells reachable within MP (4-dir BFS — the Move `bfs_*` queue-discipline twin), including the mob's own cell.
  const reachable = get_reachable_cells(
    entity.cell,
    entity.mp,
    is_walkable,
    is_occupied,
  )

  // A single monotonic advance toward `goal` — the ONE home of the "walk, don't cast" step, shared by the
  // reposition fallback and the #1061 search walk (mirrors `combat_grid::bfs_best_toward` + `movement::walk`).
  const advance_toward = goal => {
    const landing = best_toward(entity.cell, goal, reachable)
    if (landing.x === entity.cell.x && landing.y === entity.cell.y) {
      say({
        phase: 'plan',
        chose: 'pass',
        why: `already at the local minimum toward ${goal.x},${goal.y} — ${reachable.length} reachable cell(s) on ${entity.mp} MP, none closer`,
      })
      return [/** @type {FightAction} */ ({ type: 'end_turn' })]
    }
    const path = find_path_4dir(
      entity.cell,
      landing,
      entity.mp,
      is_walkable,
      is_occupied,
    )
    if (!path) {
      say({
        phase: 'plan',
        chose: 'pass',
        why: `no 4-dir path within ${entity.mp} MP to the chosen landing ${landing.x},${landing.y}`,
      })
      return [/** @type {FightAction} */ ({ type: 'end_turn' })]
    }
    say({
      phase: 'plan',
      chose: 'move',
      why: `no cast is reachable — closing toward ${goal.x},${goal.y}, landing ${landing.x},${landing.y}`,
    })
    return [/** @type {FightAction} */ ({ type: 'move', path })]
  }

  // 0. SEARCH (#1061): nothing visible to fight ⇒ the fighter does NOT idle — it walks toward its search
  //    landmark, hunting for the vanished enemy. Only a board with no anchor at all falls back to a pass.
  if (!target) {
    const anchor = search_anchor(state, entity)
    if (anchor) return advance_toward(anchor)
    say({
      phase: 'plan',
      chose: 'pass',
      why: 'nothing visible and this board carries no search anchor to walk toward',
    })
    return [{ type: 'end_turn' }]
  }

  // 1. ATTACK: strike from the CLOSEST reachable band cell. cost 0 = strike from standing (attack-now); cost > 0 =
  //    advance exactly to that cast cell then strike (attack-move, no wasted MP). Band-aware, so a min-range spell
  //    steps to its band instead of walking into the point-blank dead zone (#606).
  const refusals = trace ? [] : null
  const cast_plan = closest_cast_cell(
    state,
    entity,
    target.cell,
    reachable,
    spell_templates,
    context,
    refusals,
  )
  // Every spell the search dropped, with the reason(s) — this is the row that separates "the kit genuinely had
  // nothing legal" from "something rejected an action it should have taken". An EMPTY kit says so too.
  for (const row of refusals ?? []) say({ phase: 'cast', ...row })
  if (trace && !refusals.length && !cast_plan)
    say({
      phase: 'cast',
      spell_id: null,
      refused: ['empty_kit'],
      cells_tried: reachable.length,
    })
  if (cast_plan) {
    const cast_action = /** @type {FightAction} */ ({
      type: 'cast',
      spell_id: cast_plan.spell_id,
      target: target.cell,
      level: cast_plan.level,
    })
    if (cast_plan.cost === 0) {
      say({
        phase: 'plan',
        chose: 'cast',
        why: `${cast_plan.spell_id} strikes ${target.id} from standing`,
      })
      return [cast_action]
    }
    const path = find_path_4dir(
      entity.cell,
      cast_plan.cell,
      entity.mp,
      is_walkable,
      is_occupied,
    )
    if (path) {
      say({
        phase: 'plan',
        chose: 'move+cast',
        why: `${cast_plan.spell_id} strikes ${target.id} from ${cast_plan.cell.x},${cast_plan.cell.y} for ${cast_plan.cost} MP`,
      })
      return [{ type: 'move', path }, cast_action]
    }
    say({
      phase: 'cast',
      spell_id: cast_plan.spell_id,
      refused: ['no_path_to_the_cast_cell'],
      cells_tried: reachable.length,
    })
  }

  // 2. REPOSITION: no reachable cast cell → a single advance toward the target, monotonic (never ends farther —
  //    MP spent only to close for next turn). Mirrors the on-chain reposition fallback.
  return advance_toward(target.cell)
}

/**
 * #1874 — THE SAME TURN, NARRATED. A mob's pass used to be indistinguishable from a defect: `ai_choose_turn`
 * answers with `[{ type: 'end_turn' }]` and nothing else, so "the kit truly had no legal action" and "something
 * rejected every action" read identically — the silent refusal the player-side bot (`fight/src/bot/policy.js`)
 * is already forbidden. This runs the PLANNER ITSELF with a trace sink — one decision home, never a parallel
 * re-derivation — and hands back the actions plus the rows it walked over:
 *   · `{ phase: 'target', chose, why }`            — who it is playing against, or why nobody
 *   · `{ phase: 'cast', spell_id, refused[], cells_tried }` — one row per spell refused EVERYWHERE it stood
 *   · `{ phase: 'plan', chose, why }`              — cast / move+cast / move / pass, and the reason
 * Pure: same inputs, same actions AND same trace. The reducer never passes a sink, so live turns are unchanged.
 * @param {import('./fight_state.js').FightState} state
 * @param {string} entity_id
 * @param {Map<string, import('./spell_templates.js').SpellTemplate>} spell_templates
 * @param {(cell: import('./cell.js').Cell) => boolean} is_walkable
 * @param {(cell: import('./cell.js').Cell) => boolean} is_occupied
 * @param {import('./spell_targeting.js').TargetingContext} context
 * @returns {{ actions: FightAction[], trace: TraceRow[] }}
 */
export const ai_explain_turn = (
  state,
  entity_id,
  spell_templates,
  is_walkable,
  is_occupied,
  context,
) => {
  const trace = /** @type {TraceRow[]} */ ([])
  const actions = ai_choose_turn(
    state,
    entity_id,
    spell_templates,
    is_walkable,
    is_occupied,
    context,
    trace,
  )
  return { actions, trace }
}
