// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Reviewed twin of aresrpg_math::combat_grid through the zones section.

import { AREA_SHAPES, CONTRACT_CONSTANTS, DIRECTIONS } from './move_contract.gen.ts'

const GRID_W = BigInt(CONTRACT_CONSTANTS.grid_w)
const GRID_H = BigInt(CONTRACT_CONSTANTS.grid_h)
export const GRID_CELLS = BigInt(CONTRACT_CONSTANTS.grid_cells)
const MASK_WORDS = Number(CONTRACT_CONSTANTS.mask_words)
const DIR_POSITIVE_X = BigInt(DIRECTIONS.positive_x)
const DIR_NEGATIVE_X = BigInt(DIRECTIONS.negative_x)
const DIR_POSITIVE_Y = BigInt(DIRECTIONS.positive_y)
const DIR_NEGATIVE_Y = BigInt(DIRECTIONS.negative_y)
const DIR_NONE = BigInt(DIRECTIONS.none)
const DIRECTION_STEPS = Object.freeze([
  Object.freeze({ x: 1n, y: 0n }),
  Object.freeze({ x: -1n, y: 0n }),
  Object.freeze({ x: 0n, y: 1n }),
  Object.freeze({ x: 0n, y: -1n }),
])

export const CARDINAL_DIRECTIONS = Object.freeze([DIR_POSITIVE_X, DIR_NEGATIVE_X, DIR_POSITIVE_Y, DIR_NEGATIVE_Y])

type Mask = bigint[]
type CastCellSearch = {
  start: bigint
  target: bigint
  wall_mask: Mask
  budget: bigint
  range_min: bigint
  range_max: bigint
  needs_los: boolean
  obstacles: bigint[]
}

const shape = (name: keyof typeof AREA_SHAPES): bigint => BigInt(AREA_SHAPES[name])
const absolute_difference = (left: bigint, right: bigint): bigint => (left > right ? left - right : right - left)
const cell_x = (cell: bigint): bigint => cell % GRID_W
const cell_y = (cell: bigint): bigint => cell / GRID_W

export const encode_cell = (x: bigint, y: bigint): bigint => y * GRID_W + x
export const in_grid = (cell: bigint): boolean => cell >= 0n && cell < GRID_CELLS
export const manhattan = (left: bigint, right: bigint): bigint =>
  absolute_difference(cell_x(left), cell_x(right)) + absolute_difference(cell_y(left), cell_y(right))
export const same_line = (left: bigint, right: bigint): boolean =>
  cell_x(left) === cell_x(right) || cell_y(left) === cell_y(right)

export const empty_mask = (): Mask => Array.from({ length: MASK_WORDS }, () => 0n)

export const mask_get = (mask: Mask, cell: bigint): boolean => {
  if (!in_grid(cell)) return false
  const word = Number(cell / 64n)
  return word < mask.length && ((mask[word] >> (cell % 64n)) & 1n) === 1n
}

export const mask_from_cells = (cells: readonly bigint[]): Mask =>
  cells.reduce((mask, cell) => {
    if (!in_grid(cell)) return mask
    const word = Number(cell / 64n)
    return mask.map((value, index) => (index === word ? value | (1n << (cell % 64n)) : value))
  }, empty_mask())

export const mask_add_cells = (mask: Mask, cells: readonly bigint[]): Mask => {
  const additions = mask_from_cells(cells)
  return mask.map((word, index) => word | additions[index])
}

export const path_is_walkable = (
  start: bigint,
  path: readonly bigint[],
  wall_mask: Mask,
  max_steps: bigint
): boolean => {
  if (!in_grid(start) || BigInt(path.length) > max_steps) return false
  return path.reduce(
    (result, cell) => ({
      valid: result.valid && in_grid(cell) && !mask_get(wall_mask, cell) && manhattan(result.previous, cell) === 1n,
      previous: cell,
    }),
    { valid: true, previous: start }
  ).valid
}

export const neighbours = (cell: bigint): bigint[] => {
  const x = cell_x(cell)
  const y = cell_y(cell)
  return [
    ...(x > 0n ? [cell - 1n] : []),
    ...(x + 1n < GRID_W ? [cell + 1n] : []),
    ...(y > 0n ? [cell - GRID_W] : []),
    ...(y + 1n < GRID_H ? [cell + GRID_W] : []),
  ]
}

export const bfs_distance_field = (target: bigint, wall_mask: Mask, max_steps: bigint): bigint[] => {
  const field = Array.from({ length: Number(GRID_CELLS) }, () => GRID_CELLS)
  if (!in_grid(target) || mask_get(wall_mask, target)) return field
  field[Number(target)] = 0n
  let frontier = [target]
  let steps = 0n
  while (steps < max_steps && frontier.length > 0) {
    steps += 1n
    const next: bigint[] = []
    frontier.forEach((cell) => {
      neighbours(cell).forEach((candidate) => {
        if (field[Number(candidate)] === GRID_CELLS && !mask_get(wall_mask, candidate)) {
          field[Number(candidate)] = steps
          next.push(candidate)
        }
      })
    })
    frontier = next
  }
  return field
}

/** The APPROACH FIELD to `target`: distances to the nearest of the target's open flanks
 * (its in-grid, unwalled neighbours — the target's own cell is usually a body and thus a
 * wall). One flood answers "which way around" for the whole board, so a rusher just walks
 * DOWN it; the flood stops early once `until` (the rusher's cell) is assigned. A sealed
 * target has no open flank — everything reads the unreachable sentinel and the rusher holds.
 * Twin of aresrpg_math::combat_grid::approach_field — mirror every change. */
export const approach_field = (target: bigint, wall_mask: Mask, until: bigint): bigint[] => {
  const field = Array.from({ length: Number(GRID_CELLS) }, () => GRID_CELLS)
  let frontier: bigint[] = []
  neighbours(target).forEach((flank) => {
    if (!mask_get(wall_mask, flank)) {
      field[Number(flank)] = 0n
      frontier.push(flank)
    }
  })
  let steps = 0n
  while (frontier.length > 0 && field[Number(until)] === GRID_CELLS) {
    steps += 1n
    const next: bigint[] = []
    frontier.forEach((cell) => {
      neighbours(cell).forEach((candidate) => {
        if (field[Number(candidate)] === GRID_CELLS && !mask_get(wall_mask, candidate)) {
          field[Number(candidate)] = steps
          next.push(candidate)
        }
      })
    })
    frontier = next
  }
  return field
}

const cell_can_cast = (
  from: bigint,
  target: bigint,
  range_min: bigint,
  range_max: bigint,
  needs_los: boolean,
  obstacles: bigint[]
): boolean => {
  const distance = manhattan(from, target)
  return distance >= range_min && distance <= range_max && (!needs_los || line_of_sight(from, target, obstacles))
}

export const bfs_cast_cell = ({
  start,
  target,
  wall_mask,
  budget,
  range_min,
  range_max,
  needs_los,
  obstacles,
}: CastCellSearch): bigint | null => {
  if (!in_grid(start)) return null
  let best = start
  let found = cell_can_cast(start, target, range_min, range_max, needs_los, obstacles)
  let best_distance = found ? manhattan(start, target) : 0n
  let visited = mask_from_cells([start])
  let frontier = [start]
  let cost = 0n
  while (cost < budget && frontier.length > 0 && !found) {
    cost += 1n
    const next: bigint[] = []
    frontier.forEach((cell) => {
      neighbours(cell).forEach((candidate) => {
        if (!mask_get(visited, candidate) && !mask_get(wall_mask, candidate)) {
          visited = mask_add_cells(visited, [candidate])
          next.push(candidate)
          if (cell_can_cast(candidate, target, range_min, range_max, needs_los, obstacles)) {
            const distance = manhattan(candidate, target)
            if (!found || distance < best_distance || (distance === best_distance && candidate < best)) {
              best = candidate
              found = true
              best_distance = distance
            }
          }
        }
      })
    })
    frontier = next
  }
  return found ? best : null
}

const blocks = (origin: bigint, blocker: bigint, target: bigint): boolean => {
  if (blocker === origin || blocker === target) return false
  const origin_x = cell_x(origin)
  const origin_y = cell_y(origin)
  const blocker_x = cell_x(blocker)
  const blocker_y = cell_y(blocker)
  const target_x = cell_x(target)
  const target_y = cell_y(target)
  const axis_x = absolute_difference(blocker_x, origin_x)
  const axis_y = absolute_difference(blocker_y, origin_y)
  const target_axis_x = absolute_difference(target_x, origin_x)
  const target_axis_y = absolute_difference(target_y, origin_y)
  if (blocker_x !== origin_x && blocker_x >= origin_x !== target_x >= origin_x) return false
  if (blocker_y !== origin_y && blocker_y >= origin_y !== target_y >= origin_y) return false
  if (target_axis_x < axis_x || target_axis_y < axis_y) return false
  if (target_axis_x === axis_x && target_axis_y === axis_y) return false
  const above_low_slope =
    axis_x === 0n || target_axis_y === 0n || target_axis_x * (2n * axis_y + 1n) > (2n * axis_x - 1n) * target_axis_y
  if (!above_low_slope) return false
  if (axis_y === 0n) return blocker_x < origin_x || target_axis_x > axis_x
  if (target_axis_y === 0n) return false
  return target_axis_x * (2n * axis_y - 1n) < (2n * axis_x + 1n) * target_axis_y
}

export const line_of_sight = (from: bigint, to: bigint, obstacles: readonly bigint[]): boolean =>
  !obstacles.some((blocker) => blocks(from, blocker, to))

export const away_dir = (pivot: bigint, subject: bigint): bigint => {
  const delta_x = absolute_difference(cell_x(subject), cell_x(pivot))
  const delta_y = absolute_difference(cell_y(subject), cell_y(pivot))
  if (delta_x === 0n && delta_y === 0n) return DIR_NONE
  if (delta_x >= delta_y) return cell_x(subject) >= cell_x(pivot) ? DIR_POSITIVE_X : DIR_NEGATIVE_X
  return cell_y(subject) >= cell_y(pivot) ? DIR_POSITIVE_Y : DIR_NEGATIVE_Y
}

const opposite_dir = (direction: bigint): bigint => {
  if (direction === DIR_POSITIVE_X) return DIR_NEGATIVE_X
  if (direction === DIR_NEGATIVE_X) return DIR_POSITIVE_X
  if (direction === DIR_POSITIVE_Y) return DIR_NEGATIVE_Y
  if (direction === DIR_NEGATIVE_Y) return DIR_POSITIVE_Y
  return DIR_NONE
}

export const toward_dir = (pivot: bigint, subject: bigint): bigint => opposite_dir(away_dir(pivot, subject))

export const step_cell = (cell: bigint, direction: bigint): bigint | null => {
  const x = cell_x(cell)
  const y = cell_y(cell)
  if (direction === DIR_POSITIVE_X) return x + 1n < GRID_W ? encode_cell(x + 1n, y) : null
  if (direction === DIR_NEGATIVE_X) return x >= 1n ? encode_cell(x - 1n, y) : null
  if (direction === DIR_POSITIVE_Y) return y + 1n < GRID_H ? encode_cell(x, y + 1n) : null
  if (direction === DIR_NEGATIVE_Y) return y >= 1n ? encode_cell(x, y - 1n) : null
  return null
}

export const in_zone = (shape_code: bigint, size: bigint, anchor: bigint, cell: bigint): boolean => {
  if (!in_grid(cell)) return false
  if (shape_code === shape('point')) return cell === anchor
  if (shape_code === shape('allmap')) return true
  const distance = manhattan(anchor, cell)
  if (shape_code === shape('ring')) return distance === size
  if (shape_code === shape('cross')) return distance <= size && same_line(cell, anchor)
  return distance <= size
}

const directed_distance = (origin: bigint, direction: bigint, cell: bigint): bigint | null => {
  const step = DIRECTION_STEPS[Number(direction)]
  if (!step) return null
  const origin_x = cell_x(origin)
  const origin_y = cell_y(origin)
  const delta_x = cell_x(cell) - origin_x
  const delta_y = cell_y(cell) - origin_y
  const distance = delta_x * step.x + delta_y * step.y
  const cross = delta_x * step.y - delta_y * step.x
  return cross === 0n && distance >= 0n ? distance : null
}

const walk_rank = (origin: bigint, direction: bigint, size: bigint, cell: bigint): bigint | null => {
  const distance = directed_distance(origin, direction, cell)
  return distance !== null && distance >= 1n && distance <= size ? distance : null
}

const walk_capacity = (origin: bigint, direction: bigint, size: bigint): bigint => {
  const step = DIRECTION_STEPS[Number(direction)]
  if (!step) return 0n
  const x = cell_x(origin)
  const y = cell_y(origin)
  const horizontal = step.x > 0n ? GRID_W - 1n - x : x
  const vertical = step.y > 0n ? GRID_H - 1n - y : y
  const available = step.x === 0n ? vertical : horizontal
  return size < available ? size : available
}

const perpendicular_directions = (direction: bigint): readonly [bigint, bigint] =>
  direction === DIR_POSITIVE_X || direction === DIR_NEGATIVE_X || direction === DIR_NONE
    ? [DIR_POSITIVE_Y, DIR_NEGATIVE_Y]
    : [DIR_POSITIVE_X, DIR_NEGATIVE_X]

const line_rank = (anchor: bigint, caster: bigint, size: bigint, cell: bigint): bigint | null =>
  cell === anchor ? 0n : walk_rank(anchor, away_dir(caster, anchor), size, cell)

const tbar_rank = (anchor: bigint, caster: bigint, size: bigint, cell: bigint): bigint | null => {
  if (cell === anchor) return 0n
  const direction = away_dir(caster, anchor)
  const [perpendicular_a, perpendicular_b] = perpendicular_directions(direction)
  const first = walk_rank(anchor, perpendicular_a, size, cell)
  if (first !== null) return first
  const second = walk_rank(anchor, perpendicular_b, size, cell)
  return second === null ? null : walk_capacity(anchor, perpendicular_a, size) + second
}

const tbar_length = (anchor: bigint, direction: bigint, size: bigint): bigint => {
  const [perpendicular_a, perpendicular_b] = perpendicular_directions(direction)
  return 1n + walk_capacity(anchor, perpendicular_a, size) + walk_capacity(anchor, perpendicular_b, size)
}

const cone_depth_start = (depth: bigint, width: bigint): bigint => (depth === 1n ? 0n : 1n + (depth - 2n) * width)

const cone_side_rank = (
  caster: bigint,
  direction: bigint,
  perpendicular: bigint,
  size: bigint,
  cell: bigint,
  width: bigint,
  offset: bigint
): bigint | null => {
  const center = step_cell(cell, opposite_dir(perpendicular))
  if (center === null) return null
  const depth = walk_rank(caster, direction, size, center)
  if (depth === null || depth < 2n) return null
  if (step_cell(center, perpendicular) !== cell) return null
  return cone_depth_start(depth, width) + offset
}

const cone_rank = (anchor: bigint, caster: bigint, size: bigint, cell: bigint): bigint | null => {
  const direction = away_dir(caster, anchor)
  const first_center = step_cell(caster, direction)
  if (first_center === null) return null
  const [perpendicular_a, perpendicular_b] = perpendicular_directions(direction)
  const has_a = step_cell(first_center, perpendicular_a) !== null
  const has_b = step_cell(first_center, perpendicular_b) !== null
  const width = 1n + (has_a ? 1n : 0n) + (has_b ? 1n : 0n)
  const center_depth = walk_rank(caster, direction, size, cell)
  if (center_depth !== null) return cone_depth_start(center_depth, width)
  if (size < 2n) return null
  const side_a = cone_side_rank(caster, direction, perpendicular_a, size, cell, width, 1n)
  return side_a ?? cone_side_rank(caster, direction, perpendicular_b, size, cell, width, 1n + (has_a ? 1n : 0n))
}

const podium_rank = (anchor: bigint, caster: bigint, size: bigint, cell: bigint): bigint | null => {
  const bar = tbar_rank(anchor, caster, size, cell)
  if (bar !== null) return bar
  const direction = away_dir(caster, anchor)
  return step_cell(anchor, direction) === cell ? tbar_length(anchor, direction, size) : null
}

/** The target's deterministic position inside a cast zone. Runtime targeting asks this once
 * per fighter instead of expanding a sparse roster into all 380 board cells. */
export const zone_rank = (
  shape_code: bigint,
  size: bigint,
  anchor: bigint,
  caster: bigint,
  cell: bigint
): bigint | null => {
  if (!in_grid(cell)) return null
  if (shape_code === shape('point')) return cell === anchor ? 0n : null
  if (shape_code === shape('line')) return line_rank(anchor, caster, size, cell)
  if (shape_code === shape('tbar')) return tbar_rank(anchor, caster, size, cell)
  if (shape_code === shape('podium')) return podium_rank(anchor, caster, size, cell)
  if (shape_code === shape('cone')) return cone_rank(anchor, caster, size, cell)
  return in_zone(shape_code, size, anchor, cell) ? cell : null
}

const walk_direction = (anchor: bigint, direction: bigint, count: bigint): bigint[] => {
  const out: bigint[] = []
  let current = anchor
  let index = 0n
  while (index < count) {
    const next = step_cell(current, direction)
    if (next === null) break
    current = next
    out.push(current)
    index += 1n
  }
  return out
}

const tbar_cells = (anchor: bigint, caster: bigint, size: bigint): bigint[] => {
  const direction = away_dir(caster, anchor)
  const perpendicular = perpendicular_directions(direction)
  return [anchor, ...walk_direction(anchor, perpendicular[0], size), ...walk_direction(anchor, perpendicular[1], size)]
}

const cone_cells = (anchor: bigint, caster: bigint, size: bigint): bigint[] => {
  const direction = away_dir(caster, anchor)
  const perpendicular = perpendicular_directions(direction)
  const out: bigint[] = []
  let center = caster
  let depth = 0n
  while (depth < size) {
    const next = step_cell(center, direction)
    if (next === null) break
    center = next
    out.push(center)
    if (depth > 0n) {
      const left = step_cell(center, perpendicular[0])
      const right = step_cell(center, perpendicular[1])
      if (left !== null) out.push(left)
      if (right !== null) out.push(right)
    }
    depth += 1n
  }
  return out
}

export const zone_cells = (shape_code: bigint, size: bigint, anchor: bigint, caster: bigint): bigint[] => {
  if (shape_code === shape('point')) return [anchor]
  if (shape_code === shape('line')) return [anchor, ...walk_direction(anchor, away_dir(caster, anchor), size)]
  if (shape_code === shape('tbar')) return tbar_cells(anchor, caster, size)
  if (shape_code === shape('podium')) {
    const forward = step_cell(anchor, away_dir(caster, anchor))
    return [...tbar_cells(anchor, caster, size), ...(forward === null ? [] : [forward])]
  }
  if (shape_code === shape('cone')) return cone_cells(anchor, caster, size)
  // allmap is the ONE shape a box would silently amputate — it keeps the board scan.
  if (shape_code === shape('allmap'))
    return Array.from({ length: Number(GRID_CELLS) }, (_, index) => BigInt(index)).filter((cell) =>
      in_zone(shape_code, size, anchor, cell)
    )
  // circle / cross / ring / blob live inside the anchor's ±size box — scan that, not 380.
  const ax = cell_x(anchor)
  const ay = cell_y(anchor)
  const x0 = ax > size ? ax - size : 0n
  const y0 = ay > size ? ay - size : 0n
  const x1 = ax + size < GRID_W - 1n ? ax + size : GRID_W - 1n
  const y1 = ay + size < GRID_H - 1n ? ay + size : GRID_H - 1n
  const out: bigint[] = []
  for (let y = y0; y <= y1; y += 1n) {
    for (let x = x0; x <= x1; x += 1n) {
      const cell = encode_cell(x, y)
      if (in_zone(shape_code, size, anchor, cell)) out.push(cell)
    }
  }
  return out
}
