// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Spell range / linearity / AoE / targeting validation.
//
// PORTED from koshi-2d/.../shared/src/spells/targeting.ts. Pure integer math. REUSES the sim's own
// `manhattan` (combat_grid.js) and `has_line_of_sight` (visibility.js) instead of the donor's
// pathfinding.ts copies. area_type is the sim-internal UPPERCASE canon ('CIRCLE'|'SQUARE'|'LINE'),
// produced by spell_templates.js from the seed's lowercase JSON.

import { GRID_H, GRID_W, manhattan } from './combat_grid.js'
import { has_line_of_sight } from './visibility.js'
import {
  SHAPE_ALLMAP,
  SHAPE_CIRCLE,
  SHAPE_CONE,
  SHAPE_CROSS,
  SHAPE_LINE,
  SHAPE_POINT,
  SHAPE_PODIUM,
  SHAPE_RING,
  SHAPE_TBAR,
  TF_NOT_ENEMY,
  TF_NOT_SELF,
  TF_NOT_TEAM,
  TF_ONLY_CASTER,
} from './spell_effect.js'

/**
 * Targeting context: the board facts consumed by the single cast-legality predicate.
 * @typedef {object} TargetingContext
 * @property {(cell: import('./cell.js').Cell) => boolean} blocks_los
 * @property {(cell: import('./cell.js').Cell) => boolean} is_occupied
 * @property {((cell: import('./cell.js').Cell) => boolean)} [is_trapped] true when a live trap already anchors here
 * @property {((cell: import('./cell.js').Cell) => boolean)} [target_cap_reached] true when this spell/caster spent the cell's per-target allowance
 */

/**
 * Whether one effect hits a candidate fighter. Mirrors Move spell_target::effect_hits exactly: ONLY_CASTER
 * takes precedence over every exclusion bit, then NOT_SELF, NOT_TEAM, and NOT_ENEMY are applied in order.
 * @param {number} target_filter
 * @param {boolean} is_caster
 * @param {boolean} same_team
 * @returns {boolean}
 */
export const effect_hits = (target_filter, is_caster, same_team) => {
  if ((target_filter & TF_ONLY_CASTER) === TF_ONLY_CASTER) return is_caster
  if ((target_filter & TF_NOT_SELF) === TF_NOT_SELF && is_caster) return false
  if ((target_filter & TF_NOT_TEAM) === TF_NOT_TEAM && same_team) return false
  if ((target_filter & TF_NOT_ENEMY) === TF_NOT_ENEMY && !same_team)
    return false
  return true
}

/**
 * Is the target within the spell's [min, max] range (manhattan)? Donor targeting.ts:21.
 * @param {import('./spell_templates.js').SpellLevel} spell
 * @param {import('./cell.js').Cell} caster
 * @param {import('./cell.js').Cell} target
 * @param {number} [range_bonus]
 * @returns {boolean}
 */
export const is_in_range = (spell, caster, target, range_bonus = 0) => {
  const distance = manhattan(caster, target)
  const [min_range, max_range] = spell.range
  const effective_max = spell.modifiable_range
    ? max_range + range_bonus
    : max_range
  return distance >= min_range && distance <= effective_max
}

/**
 * Is the target orthogonally aligned with the caster? Mirrors
 * packages/move/foundation/sources/spell_target.move:40: manhattan === cheby, so only a shared row or column passes.
 * @param {import('./cell.js').Cell} caster
 * @param {import('./cell.js').Cell} target
 * @returns {boolean}
 */
export const is_linear = (caster, target) => {
  const dx = Math.abs(target.x - caster.x)
  const dy = Math.abs(target.y - caster.y)
  const cheby = Math.max(dx, dy)
  return manhattan(caster, target) === cheby
}

/**
 * Whether the level's normal effect list places a trap. The resolver validates the normal list before its crit
 * branch is selected today; keep the predicate on that same list while projected frontend levels expose it as
 * `effects` instead of `base_effects`.
 * @param {import('./spell_templates.js').SpellLevel | { effects?: Array<{type?:string, kind?:string}> }} spell
 */
export const places_trap = spell =>
  ('base_effects' in spell ? spell.base_effects : (spell.effects ?? [])).some(
    effect => effect.type === 'PLACE_TRAP' || effect.kind === 'PLACE_TRAP',
  )

/**
 * Full targeting gate: range + orthogonal line-launch + line-of-sight + free-cell + trap no-stack + per-target
 * cap. Optional context facts default open so world/AI callers that cannot observe dungeon-only state retain their
 * existing behavior; dungeon prediction/resolution and every paint/click caller provide the facts they own.
 * @param {import('./spell_templates.js').SpellLevel} spell
 * @param {import('./cell.js').Cell} caster
 * @param {import('./cell.js').Cell} target
 * @param {TargetingContext} context
 * @param {number} [range_bonus]
 * @returns {boolean}
 */
export const can_target = (spell, caster, target, context, range_bonus = 0) => {
  if (!is_in_range(spell, caster, target, range_bonus)) return false
  if (spell.linear && !is_linear(caster, target)) return false
  if (spell.line_of_sight) {
    const blocks = cell => context.blocks_los(cell) || context.is_occupied(cell)
    if (!has_line_of_sight(caster, target, blocks)) return false
  }
  // free_cell (traps/glyphs/teleport) must land on a FREE, NON-BLOCKED cell — reject BOTH an occupied cell
  // (any entity, incl. the caster's own via is_occupied) AND blocked/non-walkable terrain (blocks_los is
  // true for a wall). Traps must land on non-blocked cells. The chain twin spell_target::can_cast_at
  // rejects occupancy; the client wash cast_range_set_dungeon rejects the same blocker set — one rule.
  if (
    spell.free_cell &&
    (context.is_occupied(target) || context.blocks_los(target))
  )
    return false
  if (places_trap(spell) && context.is_trapped?.(target)) return false
  if (context.target_cap_reached?.(target)) return false
  return true
}

/**
 * Every cell this spell can legally target from the caster's position (for client highlighting / AI).
 * Donor targeting.ts:85.
 * @param {import('./spell_templates.js').SpellLevel} spell
 * @param {import('./cell.js').Cell} caster
 * @param {TargetingContext} context
 * @param {number} [range_bonus]
 * @returns {import('./cell.js').Cell[]}
 */
export const get_targetable_cells = (
  spell,
  caster,
  context,
  range_bonus = 0,
) => {
  const [min_range, max_range] = spell.range
  const effective_max = spell.modifiable_range
    ? max_range + range_bonus
    : max_range
  const cells = []
  for (let dx = -effective_max; dx <= effective_max; dx++) {
    for (let dy = -effective_max; dy <= effective_max; dy++) {
      const target = { x: caster.x + dx, y: caster.y + dy }
      if (dx === 0 && dy === 0 && min_range > 0) continue
      if (can_target(spell, caster, target, context, range_bonus))
        cells.push(target)
    }
  }
  return cells
}

// ── Area of effect ────────────────────────────────────────────────────────────

/**
 * Normalized step direction (-1, 0, 1) from -> to. Donor targeting.ts:118.
 * @param {import('./cell.js').Cell} from
 * @param {import('./cell.js').Cell} to
 * @returns {import('./cell.js').Cell}
 */
const normalized_direction = (from, to) => {
  const dx = to.x - from.x
  const dy = to.y - from.y
  return {
    x: dx === 0 ? 0 : dx > 0 ? 1 : -1,
    y: dy === 0 ? 0 : dy > 0 ? 1 : -1,
  }
}

const dominant_direction = (from, to) => {
  const dx = to.x - from.x
  const dy = to.y - from.y
  if (dx === 0 && dy === 0) return { x: 0, y: 0 }
  if (Math.abs(dx) >= Math.abs(dy)) return { x: dx >= 0 ? 1 : -1, y: 0 }
  return { x: 0, y: dy >= 0 ? 1 : -1 }
}

const in_grid = cell =>
  cell.x >= 0 && cell.x < GRID_W && cell.y >= 0 && cell.y < GRID_H

const walk_cells = (anchor, direction, count) => {
  const cells = []
  let current = anchor
  for (let i = 0; i < count; i++) {
    const next = {
      x: current.x + direction.x,
      y: current.y + direction.y,
    }
    if (!in_grid(next)) break
    cells.push(next)
    current = next
  }
  return cells
}

/**
 * Filled diamond (manhattan radius) around a target. Donor targeting.ts:130.
 * @param {import('./cell.js').Cell} target
 * @param {number} radius
 * @returns {import('./cell.js').Cell[]}
 */
const cells_in_circle = (target, radius) => {
  const cells = []
  for (let dx = -radius; dx <= radius; dx++)
    for (let dy = -radius; dy <= radius; dy++)
      if (manhattan({ x: 0, y: 0 }, { x: dx, y: dy }) <= radius)
        cells.push({ x: target.x + dx, y: target.y + dy })
  return cells
}

/**
 * Plus/cross of arms `size` long around a target. Donor targeting.ts:145.
 * @param {import('./cell.js').Cell} target
 * @param {number} size
 * @returns {import('./cell.js').Cell[]}
 */
const cells_in_cross = (target, size) => {
  const cells = [target]
  for (let i = 1; i <= size; i++) {
    cells.push({ x: target.x + i, y: target.y })
    cells.push({ x: target.x - i, y: target.y })
    cells.push({ x: target.x, y: target.y + i })
    cells.push({ x: target.x, y: target.y - i })
  }
  return cells
}

/**
 * A line of `length` cells from the target, continuing the caster->target direction. Donor targeting.ts:159.
 * @param {import('./cell.js').Cell} caster
 * @param {import('./cell.js').Cell} target
 * @param {number} length
 * @returns {import('./cell.js').Cell[]}
 */
const cells_in_line = (
  caster,
  target,
  length,
  direction_of = normalized_direction,
) => {
  const direction = direction_of(caster, target)
  if (direction.x === 0 && direction.y === 0) return [target]
  return [target, ...walk_cells(target, direction, length - 1)]
}

const cells_in_tbar = (caster, target, size) => {
  const along = dominant_direction(caster, target)
  const first = along.y === 0 ? { x: 0, y: 1 } : { x: 1, y: 0 }
  const second = { x: -first.x, y: -first.y }
  return [
    target,
    ...walk_cells(target, first, size),
    ...walk_cells(target, second, size),
  ]
}

// PODIUM (#387) — the TBAR front arc AT the aimed cell PLUS one cell BEYOND it along the strike axis. The chain
// twin is `combat_grid::podium_cells`, same construction: tbar ∪ { the one forward step }, off-grid dropped.
const cells_in_podium = (caster, target, size) => {
  const forward = dominant_direction(caster, target)
  const cells = cells_in_tbar(caster, target, size)
  if (forward.x === 0 && forward.y === 0) return cells
  const beyond = { x: target.x + forward.x, y: target.y + forward.y }
  return in_grid(beyond) ? [...cells, beyond] : cells
}

const cells_in_cone = (caster, target, size) => {
  const direction = dominant_direction(caster, target)
  if (direction.x === 0 && direction.y === 0) return []
  const first = direction.x !== 0 ? { x: 0, y: 1 } : { x: 1, y: 0 }
  const second = { x: -first.x, y: -first.y }
  const cells = []
  let center = caster
  for (let depth = 0; depth < size; depth++) {
    const next = {
      x: center.x + direction.x,
      y: center.y + direction.y,
    }
    if (!in_grid(next)) break
    center = next
    cells.push(center)
    if (depth > 0) {
      const a = { x: center.x + first.x, y: center.y + first.y }
      const b = { x: center.x + second.x, y: center.y + second.y }
      if (in_grid(a)) cells.push(a)
      if (in_grid(b)) cells.push(b)
    }
  }
  return cells
}

const scan_grid = predicate => {
  const cells = []
  for (let y = 0; y < GRID_H; y++)
    for (let x = 0; x < GRID_W; x++) {
      const cell = { x, y }
      if (predicate(cell)) cells.push(cell)
    }
  return cells
}

/**
 * Resolve the spell's area-of-effect to a concrete cell set around the target. Donor targeting.ts:176.
 * @param {import('./spell_templates.js').SpellLevel | import('./spell_templates.js').SpellEffect} spell
 * @param {import('./cell.js').Cell} target
 * @param {import('./cell.js').Cell} [caster]  required for LINE areas
 * @returns {import('./cell.js').Cell[]}
 */
export const get_aoe_cells = (spell, target, caster) => {
  const effect_area = 'area_shape' in spell
  const area = effect_area ? (spell.area_size ?? spell.area ?? 0) : spell.area
  const shape = effect_area ? spell.area_shape : undefined
  if (shape !== undefined) {
    if (shape === SHAPE_POINT) return [target]
    if (shape === SHAPE_CIRCLE)
      return scan_grid(cell => manhattan(target, cell) <= area)
    if (shape === SHAPE_CROSS)
      return scan_grid(
        cell =>
          manhattan(target, cell) <= area &&
          (cell.x === target.x || cell.y === target.y),
      )
    if (shape === SHAPE_LINE && caster)
      return cells_in_line(caster, target, area + 1, dominant_direction)
    if (shape === SHAPE_TBAR && caster)
      return cells_in_tbar(caster, target, area)
    if (shape === SHAPE_PODIUM && caster)
      return cells_in_podium(caster, target, area)
    if (shape === SHAPE_RING)
      return scan_grid(cell => manhattan(target, cell) === area)
    if (shape === SHAPE_ALLMAP) return scan_grid(() => true)
    if (shape === SHAPE_CONE && caster)
      return cells_in_cone(caster, target, area)
    return [target]
  }
  if (area === 0) return [target]
  switch (spell.area_type) {
    case 'CIRCLE':
      return cells_in_circle(target, area)
    case 'SQUARE':
      return cells_in_cross(target, area)
    case 'LINE':
      if (!caster) return [target]
      return cells_in_line(caster, target, area)
    default:
      return [target]
  }
}

/** The zone shapes whose cell set depends on the CAST DIRECTION — the one thing a stored board zone has no room
 *  for. `combat_grid::in_zone` (the chain's board-coverage predicate) has no `caster` parameter at all, so each
 *  of these falls through its last line to the filled lozenge. */
const DIRECTIONAL_SHAPES = new Set([
  SHAPE_LINE,
  SHAPE_TBAR,
  SHAPE_PODIUM,
  SHAPE_CONE,
])

/**
 * The cells a PLACED trap/glyph covers (#2177). The chain never materializes a placement zone: `cast::place_effects`
 * stores the anchor plus the raw `(area_shape, area_size)` (cast.move:1769) and re-asks coverage at TRIGGER time
 * through `spell_board::trap_index_covering` → `combat_grid::in_zone` (combat_grid.move:707-718) — direction-free,
 * so line/tbar/podium/cone are all the lozenge there. Reading the CAST zone instead gave a placed trap a
 * caster-relative strip the chain never stored: the chain detonated on cells this twin did not predict.
 * @param {import('./spell_templates.js').SpellEffect} effect
 * @param {import('./cell.js').Cell} anchor  the cast target the trap/glyph is anchored on
 * @returns {import('./cell.js').Cell[]}
 */
export const board_zone_cells = (effect, anchor) =>
  get_aoe_cells(
    'area_shape' in effect
      ? DIRECTIONAL_SHAPES.has(effect.area_shape)
        ? { ...effect, area_shape: SHAPE_CIRCLE }
        : effect
      : effect.area_type === 'LINE'
        ? { ...effect, area_type: 'CIRCLE' }
        : effect,
    anchor,
    undefined,
  )
