// Line of sight — symmetric shadowcasting (octant-based, rational slopes).
//
// PORTED VERBATIM from koshi-2d/.../shared/src/visibility.ts. The donor's SDK float-geometry LoS
// (sdk/board/line_of_sight.js) is the WRONG layer (3D roam scene, {x,z}, Math.sqrt) — this grid LoS is
// the fight-sim one. Symmetric: if A sees B then B sees A.
//
// Determinism note: the slope comparisons use rational arithmetic (e.g. (2*lat-1)/(2*depth)). These are
// pure deterministic operations on small integers — same result on every machine, no PRNG, no wall-clock
// — so LoS is a stable boolean. (Floats appear only as transient slope ratios inside this LoS predicate,
// never stored in state, never feeding damage/AP math; the sim's stateful math stays integer.)

import { cell_key } from './cell.js'

/**
 * Predicate: does this cell block line of sight? (obstacle terrain OR an interposing entity)
 * @typedef {(cell: import('./cell.js').Cell) => boolean} BlocksLos
 */

/**
 * Transform octant-local (depth, lateral) into a world cell. Donor visibility.ts:21.
 * @param {import('./cell.js').Cell} origin
 * @param {number} octant
 * @param {number} depth
 * @param {number} lateral
 * @returns {import('./cell.js').Cell}
 */
const transform_octant = (origin, octant, depth, lateral) => {
  const deltas = [
    [lateral, -depth], // 0: N sector
    [depth, -lateral], // 1: NE sector
    [depth, lateral], // 2: E sector
    [lateral, depth], // 3: SE sector
    [-lateral, depth], // 4: S sector
    [-depth, lateral], // 5: SW sector
    [-depth, -lateral], // 6: W sector
    [-lateral, -depth], // 7: NW sector
  ]
  const delta = deltas[octant] ?? [0, 0]
  return { x: origin.x + (delta[0] ?? 0), y: origin.y + (delta[1] ?? 0) }
}

/**
 * Recursively scan one octant for visible cells. Donor visibility.ts:42.
 * @param {import('./cell.js').Cell} origin
 * @param {number} octant
 * @param {number} depth
 * @param {number} start_slope
 * @param {number} end_slope
 * @param {number} max_radius
 * @param {BlocksLos} blocks_los
 * @param {Set<string>} visible
 * @returns {void}
 */
const scan_octant = (
  origin,
  octant,
  depth,
  start_slope,
  end_slope,
  max_radius,
  blocks_los,
  visible,
) => {
  if (depth > max_radius) return
  if (start_slope > end_slope) return

  let prev_blocked = false
  let saved_start = start_slope

  const lateral_min = Math.max(0, Math.ceil(depth * start_slope))
  const lateral_max = Math.min(depth, Math.floor(depth * end_slope))
  if (lateral_min > lateral_max) return

  for (let lateral = lateral_min; lateral <= lateral_max; lateral++) {
    const cell = transform_octant(origin, octant, depth, lateral)

    const dx = Math.abs(cell.x - origin.x)
    const dy = Math.abs(cell.y - origin.y)
    if (dx > max_radius || dy > max_radius) continue

    const is_blocked = blocks_los(cell)

    const cell_left = (2 * lateral - 1) / (2 * depth)
    const cell_right = (2 * lateral + 1) / (2 * depth)
    const cell_visible = cell_right >= start_slope && end_slope >= cell_left
    if (cell_visible) visible.add(cell_key(cell.x, cell.y))

    if (is_blocked) {
      if (!prev_blocked) {
        const new_end = (2 * lateral - 1) / (2 * depth)
        if (saved_start < new_end)
          scan_octant(
            origin,
            octant,
            depth + 1,
            saved_start,
            new_end,
            max_radius,
            blocks_los,
            visible,
          )
      }
      prev_blocked = true
    } else {
      if (prev_blocked) saved_start = (2 * lateral - 1) / (2 * depth)
      prev_blocked = false
    }
  }

  if (!prev_blocked && saved_start < end_slope)
    scan_octant(
      origin,
      octant,
      depth + 1,
      saved_start,
      end_slope,
      max_radius,
      blocks_los,
      visible,
    )
}

/**
 * All cells visible from origin within radius (symmetric shadowcasting). Donor visibility.ts:108.
 * @param {import('./cell.js').Cell} origin
 * @param {number} max_radius
 * @param {BlocksLos} blocks_los
 * @returns {Set<string>}
 */
export const compute_visible_cells = (origin, max_radius, blocks_los) => {
  const visible = new Set([cell_key(origin.x, origin.y)])
  for (let octant = 0; octant < 8; octant++)
    scan_octant(origin, octant, 1, -1, 1, max_radius, blocks_los, visible)
  return visible
}

/**
 * Is `to` visible from `from`? Donor visibility.ts:127.
 * @param {import('./cell.js').Cell} from
 * @param {import('./cell.js').Cell} to
 * @param {BlocksLos} blocks_los
 * @returns {boolean}
 */
export const has_line_of_sight = (from, to, blocks_los) => {
  if (from.x === to.x && from.y === to.y) return true
  const dx = Math.abs(to.x - from.x)
  const dy = Math.abs(to.y - from.y)
  const max_radius = Math.max(dx, dy)
  return compute_visible_cells(from, max_radius, blocks_los).has(
    cell_key(to.x, to.y),
  )
}
