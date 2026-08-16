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

export const bfs_best_toward = (start: bigint, target: bigint, wall_mask: Mask, budget: bigint): bigint => {
  if (!in_grid(start)) return start
  let best = start
  let best_distance = manhattan(start, target)
  let best_cost = 0n
  let visited = mask_from_cells([start])
  let frontier = [start]
  let cost = 0n
  while (cost < budget && frontier.length > 0) {
    cost += 1n
    const next: bigint[] = []
    frontier.forEach((cell) => {
      neighbours(cell).forEach((candidate) => {
        if (!mask_get(visited, candidate) && !mask_get(wall_mask, candidate)) {
          visited = mask_add_cells(visited, [candidate])
          next.push(candidate)
          if (candidate !== target) {
            const distance = manhattan(candidate, target)
            if (
              distance < best_distance ||
              (distance === best_distance && cost < best_cost) ||
              (distance === best_distance && cost === best_cost && candidate < best)
            ) {
              best = candidate
              best_distance = distance
              best_cost = cost
            }
          }
        }
      })
    })
    frontier = next
  }
  return best
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
  const perpendicular =
    direction === DIR_POSITIVE_X || direction === DIR_NEGATIVE_X || direction === DIR_NONE
      ? [DIR_POSITIVE_Y, DIR_NEGATIVE_Y]
      : [DIR_POSITIVE_X, DIR_NEGATIVE_X]
  return [anchor, ...walk_direction(anchor, perpendicular[0], size), ...walk_direction(anchor, perpendicular[1], size)]
}

const cone_cells = (anchor: bigint, caster: bigint, size: bigint): bigint[] => {
  const direction = away_dir(caster, anchor)
  const perpendicular =
    direction === DIR_POSITIVE_X || direction === DIR_NEGATIVE_X || direction === DIR_NONE
      ? [DIR_POSITIVE_Y, DIR_NEGATIVE_Y]
      : [DIR_POSITIVE_X, DIR_NEGATIVE_X]
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
  return Array.from({ length: Number(GRID_CELLS) }, (_, index) => BigInt(index)).filter((cell) =>
    in_zone(shape_code, size, anchor, cell)
  )
}
