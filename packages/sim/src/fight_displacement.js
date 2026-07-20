// Canonical PUSH/PULL displacement twin. Direction, blockers, trap stopping, collision math, and recipients
// mirror the Move helper; PUSH and PULL intentionally use the same blocked-cell collision formula.

import { apply_damage } from './fight_actions.js'
import { find_entity, find_entity_at, update_entity } from './fight_state.js'

/** @typedef {{ dx: number, dy: number }} Direction */

/**
 * @typedef {object} DisplacementStep
 * @property {import('./fight_state.js').FightState} state
 * @property {import('./fight_spells.js').SpellCastEffect[]} effects
 * @property {number} cells_moved
 * @property {boolean} collision
 */

/**
 * @typedef {(state: import('./fight_state.js').FightState, cell: import('./cell.js').Cell,
 *   target_id: string) => { state: import('./fight_state.js').FightState, triggered: boolean,
 *   effects: import('./fight_spells.js').SpellCastEffect[] }} OnEnter
 */

/**
 * Dominant-axis cardinal direction; x wins ties, matching combat_grid::away_dir.
 * @param {import('./cell.js').Cell} from
 * @param {import('./cell.js').Cell} to
 * @returns {Direction}
 */
export const get_direction = (from, to) => {
  const dx = to.x - from.x
  const dy = to.y - from.y
  if (dx === 0 && dy === 0) return { dx: 0, dy: 0 }
  if (Math.abs(dx) >= Math.abs(dy)) return { dx: dx >= 0 ? 1 : -1, dy: 0 }
  return { dx: 0, dy: dy >= 0 ? 1 : -1 }
}

/**
 * Count outward steps that remain in a frozen effect zone. Direction zero and a fighter already on the edge
 * both derive distance zero; live blockers/traps remain the displacement walk's responsibility.
 * @param {import('./cell.js').Cell[]} zone
 * @param {import('./cell.js').Cell} origin
 * @param {import('./cell.js').Cell} subject
 */
export const zone_edge_distance = (zone, origin, subject) => {
  const direction = get_direction(origin, subject)
  if (direction.dx === 0 && direction.dy === 0) return 0
  let cell = subject
  let distance = 0
  for (;;) {
    const next = step_cell(cell, direction)
    if (!zone.some(c => c.x === next.x && c.y === next.y)) return distance
    cell = next
    distance += 1
  }
}

const step_cell = (cell, direction) => ({
  x: cell.x + direction.dx,
  y: cell.y + direction.dy,
})

const process_step = (
  state,
  target_id,
  direction,
  steps_remaining,
  cells_moved,
  effects,
  terrain_walkable,
  on_enter,
) => {
  if (steps_remaining === 0)
    return { state, effects, cells_moved, collision: false }
  const entity = find_entity(state, target_id)
  if (!entity || entity.health <= 0)
    return { state, effects, cells_moved, collision: false }

  const next_cell = step_cell(entity.cell, direction)
  if (!terrain_walkable(next_cell) || find_entity_at(state, next_cell))
    return { state, effects, cells_moved, collision: true }

  const moved = update_entity(state, target_id, current => ({
    ...current,
    cell: next_cell,
  }))
  const entered = on_enter?.(moved, next_cell, target_id)
  if (entered?.triggered)
    return {
      state: entered.state,
      effects: [...effects, ...entered.effects],
      cells_moved: cells_moved + 1,
      collision: false,
    }

  return process_step(
    entered?.state ?? moved,
    target_id,
    direction,
    steps_remaining - 1,
    cells_moved + 1,
    effects,
    terrain_walkable,
    on_enter,
  )
}

const apply_collision_damage = (state, target_id, caster_level, blocked_cells) => {
  const target = find_entity(state, target_id)
  if (!target || blocked_cells === 0)
    return { state, effects: [], direct_damage: 0 }
  const per_cell = Math.max(Math.floor((12 * caster_level) / 50), 1)
  const damage = per_cell * blocked_cells
  // A knockback collision is RAW environmental impact: Move lands it via hit_mob/hit_player (raw apply_damage),
  // NEVER through the incoming-hit reaction pipeline (apply_incoming_damage). So it can NEVER invert to heal,
  // redirect, reflect, erode, or punish — a knockback's hit-result is damage-or-none, one effect mirroring the
  // chain's lone Hit. (Routing it through the pipeline healed DAMAGE_TO_HEAL targets and drew a phantom rng int.)
  const hit = apply_damage(state, target_id, damage)
  const struck = find_entity(hit.state, target_id)
  return {
    state: hit.state,
    direct_damage: hit.damage_dealt,
    effects: [
      {
        target_id,
        damage: hit.damage_dealt,
        new_health: struck?.health ?? 0,
        killed: hit.killed,
      },
    ],
  }
}

/**
 * Slide a living target cell-by-cell. Terrain (edge/hole/off-shape/obstacle) and living bodies stop before the
 * blocked cell. Entering the first crossed trap resolves it after relocation and stops without collision damage.
 * @param {import('./fight_state.js').FightState} state
 * @param {string} target_id
 * @param {Direction} direction
 * @param {number} distance
 * @param {number} caster_level
 * @param {(cell: import('./cell.js').Cell) => boolean} terrain_walkable
 * @param {OnEnter} [on_enter]
 * @param {string} [source_id]
 * @returns {{ state: import('./fight_state.js').FightState, effects: import('./fight_spells.js').SpellCastEffect[], direct_damage: number }}
 */
export const handle_displacement = (
  state,
  target_id,
  direction,
  distance,
  caster_level,
  terrain_walkable,
  on_enter,
  source_id,
) => {
  const entity = find_entity(state, target_id)
  if (!entity || entity.health <= 0)
    return { state, effects: [], direct_damage: 0 }
  if (direction.dx === 0 && direction.dy === 0)
    return {
      state,
      effects: [{ target_id, cell: entity.cell, has_cell: true }],
      direct_damage: 0,
    }
  const requested = Math.max(0, Math.floor(distance))
  const result = process_step(
    state,
    target_id,
    direction,
    requested,
    0,
    [],
    terrain_walkable,
    on_enter,
  )
  const collision = result.collision
    ? apply_collision_damage(
        result.state,
        target_id,
        caster_level,
        requested - result.cells_moved,
      )
    : { state: result.state, effects: [], direct_damage: 0 }
  const displaced = find_entity(collision.state, target_id)
  const position = displaced
    ? [{ target_id, cell: displaced.cell, has_cell: true }]
    : []
  return {
    state: collision.state,
    effects: [...result.effects, ...collision.effects, ...position],
    // Trap/on-enter payload effects are deliberately excluded: only this walk's own blocked-cell collision
    // is immediate cast damage and may reveal the damager.
    direct_damage: collision.direct_damage,
  }
}
