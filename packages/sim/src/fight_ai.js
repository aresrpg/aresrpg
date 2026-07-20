// Basic enemy AI: a pure turn planner the reducer runs for mob entities.
//
// SCOPE (per the port task): "move toward + cast on the nearest enemy if in range, else move." This is the
// deterministic, dependency-light slice. The donor's exhaustive two-stage combo generator + scorer
// (ai/{generator,simulation,scoring}.ts) + its LLM `select_action` chooser are a FLAGGED TODO — deepen the
// AI later. This planner REUSES the sim's own `find_path_4dir` / `get_reachable_cells` (pathfind.js),
// `manhattan_distance` (cell.js), and `can_target` (spell_targeting.js) — no donor pathfinding/grid-context.
//
// Pure: it READS state and returns a list of FightActions; it consumes no rng (execution rolls do). Same
// state -> same plan. The reducer feeds the actions back through its own move/cast/end_turn handlers.

import { manhattan_distance } from './cell.js'
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
 * The most expensive (highest-AP) castable damage spell in hand whose AoE/range can hit `target` from
 * `from`, or null. "Castable" = AP-affordable and target legal (range/LoS/linear) via can_target.
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
  for (const spell_id of entity.hand) {
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
 * Plan a mob's turn: cast nearest-enemy if already in range, else step toward it (then cast if newly in
 * range), else end turn. Returns an ordered action list for the reducer to execute.
 *
 * @param {import('./fight_state.js').FightState} state
 * @param {string} entity_id
 * @param {Map<string, import('./spell_templates.js').SpellTemplate>} spell_templates
 * @param {(cell: import('./cell.js').Cell) => boolean} is_walkable   terrain AND occupancy (built by the reducer)
 * @param {import('./spell_targeting.js').TargetingContext} context
 * @returns {FightAction[]}
 */
export const ai_choose_turn = (
  state,
  entity_id,
  spell_templates,
  is_walkable,
  context,
) => {
  const entity = find_entity(state, entity_id)
  if (!entity) return [{ type: 'end_turn' }]

  const target = nearest_enemy(state, entity)
  if (!target) return [{ type: 'end_turn' }]

  /** @type {FightAction[]} */
  const actions = []

  // 1. Cast from the current cell if a damage spell already reaches the target.
  const here = best_castable_damage_spell(
    state,
    entity,
    entity.cell,
    target.cell,
    spell_templates,
    context,
  )
  if (here) {
    actions.push({
      type: 'cast',
      spell_id: here.spell_id,
      target: target.cell,
      level: here.level,
    })
    return actions
  }

  // 2. Otherwise move TOWARD the target: of all cells reachable within MP, pick the one minimizing manhattan
  // distance to the target (ties broken by lower MP cost, then scan order — deterministic). This handles
  // both "close the gap to get in range" and "step adjacent for melee".
  const reachable = get_reachable_cells(entity.cell, entity.mp, is_walkable)
  let best_goal = entity.cell
  let best_dist = manhattan_distance(entity.cell, target.cell)
  let best_cost = 0
  for (const { cell, cost } of reachable) {
    const dist = manhattan_distance(cell, target.cell)
    if (dist < best_dist || (dist === best_dist && cost < best_cost)) {
      best_dist = dist
      best_cost = cost
      best_goal = cell
    }
  }

  const best_path =
    best_goal.x === entity.cell.x && best_goal.y === entity.cell.y
      ? null
      : find_path_4dir(entity.cell, best_goal, entity.mp, is_walkable)

  if (best_path) {
    actions.push({ type: 'move', path: best_path })
    // 3. After moving, cast if a damage spell now reaches the target from the destination.
    const dest = best_path[best_path.length - 1]
    const after = best_castable_damage_spell(
      state,
      entity,
      dest,
      target.cell,
      spell_templates,
      context,
    )
    if (after)
      actions.push({
        type: 'cast',
        spell_id: after.spell_id,
        target: target.cell,
        level: after.level,
      })
    return actions
  }

  return [{ type: 'end_turn' }]
}
