// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Reviewed board-generation twin of aresrpg_math::combat_grid::generate.

import { BOARD_SHAPES, CONTRACT_CONSTANTS } from './move_contract.gen.ts'
import { GRID_CELLS, empty_mask, encode_cell, mask_add_cells, mask_get } from './combat_grid.ts'
import { rng_int, rng_range, rng_seed } from './prng.ts'
import type { FightBoard, PrngResult } from './types.ts'

type Mask = bigint[]
type BlobRadii = { top_left: bigint; top_right: bigint; bottom_left: bigint; bottom_right: bigint }
type ShapeBuild = { state: bigint; mask: Mask }
type BlockerProbe = { took: boolean; blocked: bigint[] }

const GRID_W = BigInt(CONTRACT_CONSTANTS.grid_w)
const GRID_H = BigInt(CONTRACT_CONSTANTS.grid_h)
const MIN_W = BigInt(CONTRACT_CONSTANTS.min_w)
const MAX_W = BigInt(CONTRACT_CONSTANTS.max_w)
const MIN_H = BigInt(CONTRACT_CONSTANTS.min_h)
const MAX_H = BigInt(CONTRACT_CONSTANTS.max_h)
const START_CELLS = Number(CONTRACT_CONSTANTS.start_cells)
const OBS_MIN = BigInt(CONTRACT_CONSTANTS.obs_min)
const OBS_MAX = BigInt(CONTRACT_CONSTANTS.obs_max)
const HOLE_MIN = BigInt(CONTRACT_CONSTANTS.hole_min)
const HOLE_MAX = BigInt(CONTRACT_CONSTANTS.hole_max)
const BLOCKER_MAX_LEN = BigInt(CONTRACT_CONSTANTS.blocker_max_len)
const N_SHAPES = BigInt(CONTRACT_CONSTANTS.n_shapes)
const VARIANT_MIX = BigInt(CONTRACT_CONSTANTS.variant_mix)

const SHAPE_ROUNDED = BigInt(BOARD_SHAPES.rounded)
const SHAPE_ELLIPSE = BigInt(BOARD_SHAPES.ellipse)
const SHAPE_CROSS = BigInt(BOARD_SHAPES.cross)
const SHAPE_BLOB = BigInt(BOARD_SHAPES.blob)

const absolute_difference = (left: bigint, right: bigint): bigint => (left > right ? left - right : right - left)
const cell_x = (cell: bigint): bigint => cell % GRID_W
const cell_y = (cell: bigint): bigint => cell / GRID_W
const min_u64 = (left: bigint, right: bigint): bigint => (left < right ? left : right)

const set_cell = (mask: Mask, cell: bigint): Mask => mask_add_cells(mask, [cell])

const fill_row = (mask: Mask, y: bigint, low: bigint, high: bigint): Mask => {
  const end = high > GRID_W ? GRID_W : high
  let output = mask
  let x = low
  while (x < end) {
    output = set_cell(output, encode_cell(x, y))
    x += 1n
  }
  return output
}

const rectangle_mask = (width: bigint, height: bigint): Mask => {
  let mask = empty_mask()
  let y = 0n
  while (y < height) {
    mask = fill_row(mask, y, 0n, width)
    y += 1n
  }
  return mask
}

const ellipse_mask = (width: bigint, height: bigint): Mask => {
  let mask = empty_mask()
  const center_x_2 = width - 1n
  const center_y_2 = height - 1n
  const right_side = width * height * (width * height)
  let y = 0n
  while (y < height) {
    const delta_y_2 = absolute_difference(2n * y, center_y_2)
    const term_y = delta_y_2 * delta_y_2 * (width * width)
    let low = width
    let high = 0n
    let x = 0n
    while (x < width) {
      const delta_x_2 = absolute_difference(2n * x, center_x_2)
      if (delta_x_2 * delta_x_2 * (height * height) + term_y <= right_side) {
        if (x < low) low = x
        if (x + 1n > high) high = x + 1n
      }
      x += 1n
    }
    if (low < high) mask = fill_row(mask, y, low, high)
    y += 1n
  }
  return mask
}

const corner_cut = (radius: bigint, y: bigint, height: bigint, top: boolean): bigint => {
  if (radius === 0n) return 0n
  const in_band = top ? y < radius : y >= height - radius
  if (!in_band) return 0n
  const delta_y = top ? radius - 1n - y : y - (height - radius)
  const arc = (radius - 1n) * (radius - 1n)
  let cut = 0n
  let index = 0n
  while (index < radius) {
    const delta_x = radius - 1n - index
    if (delta_x * delta_x + delta_y * delta_y > arc) cut = index + 1n
    else break
    index += 1n
  }
  return cut
}

const rounded_mask = (width: bigint, height: bigint, radius: bigint): Mask => {
  if (radius === 0n) return rectangle_mask(width, height)
  let mask = empty_mask()
  let y = 0n
  while (y < height) {
    const cut = corner_cut(radius, y, height, y < radius)
    mask = fill_row(mask, y, cut, width - cut)
    y += 1n
  }
  return mask
}

const blob_mask = (width: bigint, height: bigint, radii: BlobRadii): Mask => {
  let mask = empty_mask()
  let y = 0n
  while (y < height) {
    const top_left = corner_cut(radii.top_left, y, height, true)
    const top_right = corner_cut(radii.top_right, y, height, true)
    const bottom_left = corner_cut(radii.bottom_left, y, height, false)
    const bottom_right = corner_cut(radii.bottom_right, y, height, false)
    const left = top_left > bottom_left ? top_left : bottom_left
    const right = top_right > bottom_right ? top_right : bottom_right
    mask = fill_row(mask, y, left, width - right)
    y += 1n
  }
  return mask
}

const cross_outline = (
  width: bigint,
  height: bigint,
  row_start: bigint,
  row_end: bigint,
  column_start: bigint,
  column_end: bigint
): Mask => {
  let mask = empty_mask()
  let y = 0n
  while (y < height) {
    mask = y >= row_start && y < row_end ? fill_row(mask, y, 0n, width) : fill_row(mask, y, column_start, column_end)
    y += 1n
  }
  return mask
}

const draw_range = (state: bigint, minimum: bigint, maximum: bigint): PrngResult => rng_range(state, minimum, maximum)

const build_shape = (state: bigint, shape_code: bigint, width: bigint, height: bigint): ShapeBuild => {
  if (shape_code === SHAPE_ELLIPSE) return { state, mask: ellipse_mask(width, height) }
  if (shape_code === SHAPE_ROUNDED) {
    const drawn = draw_range(state, 1n, min_u64(width, height) / 3n)
    return { state: drawn.state, mask: rounded_mask(width, height, drawn.value) }
  }
  if (shape_code === SHAPE_CROSS) {
    const row = draw_range(state, 3n, height)
    const column = draw_range(row.state, 3n, width)
    const row_start = (height - row.value) / 2n
    const column_start = (width - column.value) / 2n
    return {
      state: column.state,
      mask: cross_outline(width, height, row_start, row_start + row.value, column_start, column_start + column.value),
    }
  }
  const cap = min_u64(width, height) / 3n
  const top_left = draw_range(state, 1n, cap)
  const top_right = draw_range(top_left.state, 1n, cap)
  const bottom_left = draw_range(top_right.state, 1n, cap)
  const bottom_right = draw_range(bottom_left.state, 1n, cap)
  return {
    state: bottom_right.state,
    mask: blob_mask(width, height, {
      top_left: top_left.value,
      top_right: top_right.value,
      bottom_left: bottom_left.value,
      bottom_right: bottom_right.value,
    }),
  }
}

const ring_on_mask = (mask: Mask, cell: bigint): boolean => {
  if (!mask_get(mask, cell)) return false
  const x = cell_x(cell)
  const y = cell_y(cell)
  if (x === 0n || y === 0n || x + 1n >= GRID_W || y + 1n >= GRID_H) return false
  let delta_y = 0n
  while (delta_y < 3n) {
    let delta_x = 0n
    while (delta_x < 3n) {
      if (!mask_get(mask, encode_cell(x + delta_x - 1n, y + delta_y - 1n))) return false
      delta_x += 1n
    }
    delta_y += 1n
  }
  return true
}

const ring_safe_cells = (mask: Mask): bigint[] =>
  Array.from({ length: Number(GRID_CELLS) }, (_, index) => BigInt(index)).filter((cell) => ring_on_mask(mask, cell))

const group_placeable = (mask: Mask, blocked: bigint[], cells: bigint[]): boolean =>
  cells.every(
    (cell) =>
      ring_on_mask(mask, cell) &&
      blocked.every(
        (blocked_cell) =>
          absolute_difference(cell_x(blocked_cell), cell_x(cell)) > 1n ||
          absolute_difference(cell_y(blocked_cell), cell_y(cell)) > 1n
      )
  )

const probe_run = (
  mask: Mask,
  anchors: bigint[],
  blocked: bigint[],
  start_index: bigint,
  length: bigint,
  step: bigint
): BlockerProbe => {
  let offset = 0n
  while (offset < BigInt(anchors.length)) {
    const anchor = anchors[Number((start_index + offset) % BigInt(anchors.length))]
    const cells = Array.from({ length: Number(length) }, (_, index) => anchor + BigInt(index) * step)
    if (group_placeable(mask, blocked, cells)) return { took: true, blocked: [...blocked, ...cells] }
    offset += 1n
  }
  return { took: false, blocked }
}

const place_blockers = (
  state: bigint,
  mask: Mask,
  anchors: bigint[],
  initial_blocked: bigint[],
  count: bigint
): { state: bigint; blocked: bigint[] } => {
  if (anchors.length === 0) return { state, blocked: initial_blocked }
  let cursor = state
  let blocked = initial_blocked
  let placed = 0n
  while (placed < count) {
    const length = draw_range(cursor, 1n, BLOCKER_MAX_LEN)
    const axis = rng_int(length.state, 2n)
    const step = axis.value === 0n ? 1n : GRID_W
    const start = rng_int(axis.state, BigInt(anchors.length))
    cursor = start.state
    let result = probe_run(mask, anchors, blocked, start.value, length.value, step)
    if (!result.took && length.value > 1n) result = probe_run(mask, anchors, blocked, start.value, 1n, step)
    if (!result.took) break
    const { blocked: next_blocked } = result
    blocked = next_blocked
    placed += 1n
  }
  return { state: cursor, blocked }
}

const open_cells = (mask: Mask, blocked: bigint[]): bigint[] =>
  Array.from({ length: Number(GRID_CELLS) }, (_, index) => BigInt(index)).filter(
    (cell) => mask_get(mask, cell) && !blocked.includes(cell)
  )

const pick_starts = (pool: bigint[], from_top: boolean, used: bigint[]): bigint[] => {
  const output: bigint[] = []
  let offset = 0
  while (offset < pool.length && output.length < START_CELLS) {
    const cell = pool[from_top ? offset : pool.length - 1 - offset]
    if (!used.includes(cell)) output.push(cell)
    offset += 1
  }
  return output
}

export const generate_board = (board_seed: bigint, variant = 0n): FightBoard => {
  let state = rng_seed(BigInt(board_seed) ^ (((BigInt(variant) + 1n) * VARIANT_MIX) & 0xffff_ffffn))
  const width = draw_range(state, MIN_W, MAX_W)
  const { state: after_width } = width
  state = after_width
  const height = draw_range(state, MIN_H, MAX_H)
  const { state: after_height } = height
  state = after_height
  const shape_draw = rng_int(state, N_SHAPES)
  const { state: after_shape_draw } = shape_draw
  state = after_shape_draw
  const vocabulary = [SHAPE_BLOB, SHAPE_ROUNDED, SHAPE_ELLIPSE, SHAPE_CROSS]
  const built = build_shape(state, vocabulary[Number(shape_draw.value)], width.value, height.value)
  const { state: after_build } = built
  state = after_build
  const anchors = ring_safe_cells(built.mask)
  const obstacle_count = draw_range(state, OBS_MIN, OBS_MAX)
  const obstacles_built = place_blockers(obstacle_count.state, built.mask, anchors, [], obstacle_count.value)
  const { state: after_obstacles } = obstacles_built
  state = after_obstacles
  const obstacle_length = obstacles_built.blocked.length
  const hole_count = draw_range(state, HOLE_MIN, HOLE_MAX)
  const all_blocked = place_blockers(
    hole_count.state,
    built.mask,
    anchors,
    obstacles_built.blocked,
    hole_count.value
  ).blocked
  const obstacles = all_blocked.slice(0, obstacle_length)
  const holes = all_blocked.slice(obstacle_length)
  const pool = open_cells(built.mask, all_blocked)
  const start_cells_a = pick_starts(pool, true, [])
  const start_cells_b = pick_starts(pool, false, start_cells_a)
  return {
    width: width.value,
    height: height.value,
    shape_mask: built.mask,
    obstacles,
    holes,
    start_cells_a,
    start_cells_b,
  }
}
