// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure tactical-highlight shape SSOT. The CPU helpers are exact mirrors of the TSL masks in
// board_highlight_materials.js, keeping visual geometry testable without a GPU.

/** Rounded-cell mask dials, shared by normal washes, emphasis pulses, and entity anchors. */
export const CORNER_RADIUS = 0.15
export const EDGE_SOFTNESS = 0.04
export const GRADIENT_REACH = 0.62
export const RIM_BRIGHT = true

/** Scalar smoothstep matching TSL/GLSL smoothstep. */
export function smoothstep_scalar(/** @type {number} */ e0, /** @type {number} */ e1, /** @type {number} */ x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/**
 * [#164] Rounded-rect coverage and rim-bright gradient at tile UV coordinates, UNION-AWARE: `edges`
 * marks which of the tile's four UV-space sides touch a same-channel NEIGHBOR tile — `u0`/`u1` the
 * u→0 / u→1 sides, `v0`/`v1` the v→0 / v→1 sides (board_highlights.js maps grid neighbors onto these
 * per cell_center_world's affine convention: grid -x → u0, +x → u1, -y ("up") → v1, +y ("down") → v0).
 * A merged side's corner-rounding cut AND rim brightening are suppressed ON THAT SIDE ONLY (the other
 * two sides of the same tile are untouched) — so a run of orthogonally-adjacent same-channel cells
 * reads as ONE seamless shape, rounded + rim-bright only at its true outer perimeter, flat/dim along
 * every interior seam. `edges` omitted (or every flag false) reproduces the lone-tile shape exactly —
 * rounded_rect_gradient below is this function with every side closed, kept as the ZERO-ARG common
 * case every other channel still calls.
 * @param {number} u @param {number} v
 * @param {{ u0?: boolean, u1?: boolean, v0?: boolean, v1?: boolean }} [edges]
 * @returns {{ coverage: number, grad: number }}
 */
export function merged_rect_gradient(u, v, edges = {}) {
  const { u0 = false, u1 = false, v0 = false, v1 = false } = edges
  const half = 0.5
  const su = u - half // signed: <0 nearer the u0 side, >=0 nearer the u1 side
  const sv = v - half
  const u_merged = su >= 0 ? u1 : u0
  const v_merged = sv >= 0 ? v1 : v0
  // the merged side's distance-from-center contribution is fully suppressed (as if that side of the
  // tile never approaches an edge at all) — the OTHER axis alone still drives any corner/edge falloff,
  // which is exactly the "flat seam, rounded elsewhere" read a merged run needs (see the header note).
  const px = u_merged ? 0 : Math.abs(su)
  const py = v_merged ? 0 : Math.abs(sv)
  const qx = px - (half - CORNER_RADIUS)
  const qy = py - (half - CORNER_RADIUS)
  const ox = Math.max(qx, 0)
  const oy = Math.max(qy, 0)
  const d = Math.hypot(ox, oy) - CORNER_RADIUS
  const coverage = smoothstep_scalar(0, -EDGE_SOFTNESS, d)
  const rim_t = Math.max(px, py) / half
  const grad = smoothstep_scalar(1 - GRADIENT_REACH, 1, rim_t)
  return { coverage, grad }
}

/**
 * Rounded-rect coverage and rim-bright gradient at tile UV coordinates — the lone-tile case
 * (merged_rect_gradient with every side closed). Every non-merging channel's shape SSOT.
 * @param {number} u @param {number} v
 * @returns {{ coverage: number, grad: number }}
 */
export function rounded_rect_gradient(u, v) {
  return merged_rect_gradient(u, v)
}

// ── [#164] GRID ADJACENCY → merged_rect_gradient's `edges` — pure, no GPU/controller dependency, so it
//    lives here next to the shape math it feeds (board_highlights.js maps its own cell Map onto this;
//    board_highlight_materials.js's make_merge_aware_channel consumes edges_of_mask's output shape). ──

/** The four merge-mask bits — private packing detail behind neighbor_mask/edges_of_mask below. Mapped
 *  from grid neighbors by cell_center_world's affine convention (board.js: origin + (x+0.5)*cell_size,
 *  origin + (y+0.5)*cell_size — no rotation): grid -x → u0 (LEFT), +x → u1 (RIGHT); the shared tile
 *  geometry's -90° X-axis rotation inverts local Y into world -Z, so grid -y ("up") lands on the v1
 *  side and grid +y ("down") on v0. */
const MASK_U0 = 1
const MASK_U1 = 2
const MASK_V0 = 4
const MASK_V1 = 8

/** mask (0..15) → the `edges` object merged_rect_gradient / make_gradient_tile_material expect.
 * @param {number} mask @returns {{ u0: boolean, u1: boolean, v0: boolean, v1: boolean }} */
export function edges_of_mask(mask) {
  return {
    u0: (mask & MASK_U0) !== 0,
    u1: (mask & MASK_U1) !== 0,
    v0: (mask & MASK_V0) !== 0,
    v1: (mask & MASK_V1) !== 0,
  }
}

/** This cell's neighbor bitmask against `cell_set` (a Set of "x,y" keys — the caller's own paint-call
 *  cell set only, never cross-channel): one bit per orthogonal (4-dir — "fight movement is
 *  4-directional", sim/src/cell.js neighbors_4dir) same-channel neighbor present. Diagonal-only touches
 *  never set a bit, so e.g. a hollow RING-shaped zone (get_aoe_cells SHAPE_RING — cells at exactly
 *  manhattan distance R, which touch their ring neighbors only at a corner) stays visually hollow
 *  instead of collapsing into a filled disc.
 * @param {Set<string>} cell_set @param {number} x @param {number} y @returns {number} */
export function neighbor_mask(cell_set, x, y) {
  let m = 0
  if (cell_set.has(`${x - 1},${y}`)) m |= MASK_U0
  if (cell_set.has(`${x + 1},${y}`)) m |= MASK_U1
  if (cell_set.has(`${x},${y - 1}`)) m |= MASK_V1
  if (cell_set.has(`${x},${y + 1}`)) m |= MASK_V0
  return m
}

/** Entity-anchor fill/edge dials and draw order. */
export const ENTITY_ANCHOR_FILL_OPACITY = 0.28
export const ENTITY_ANCHOR_EDGE_OPACITY = 0.95
export const ENTITY_ANCHOR_EDGE_WIDTH = 0.05
export const ENTITY_ANCHOR_RENDER_ORDER = 8

/**
 * Squared entity-anchor alpha: subtle fill plus crisp rounded-cell boundary.
 * @param {number} u @param {number} v @returns {number}
 */
export function entity_anchor_cell_alpha(u, v) {
  const px = Math.abs(u - 0.5)
  const py = Math.abs(v - 0.5)
  const half = 0.5
  const qx = px - (half - CORNER_RADIUS)
  const qy = py - (half - CORNER_RADIUS)
  const ox = Math.max(qx, 0)
  const oy = Math.max(qy, 0)
  const d = Math.hypot(ox, oy) - CORNER_RADIUS
  const fill = smoothstep_scalar(0, -EDGE_SOFTNESS, d) * ENTITY_ANCHOR_FILL_OPACITY
  const edge = (1 - smoothstep_scalar(0, ENTITY_ANCHOR_EDGE_WIDTH, Math.abs(d))) * ENTITY_ANCHOR_EDGE_OPACITY
  return Math.min(1, Math.max(fill, edge))
}
