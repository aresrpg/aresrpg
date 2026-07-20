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
 * Rounded-rect coverage and rim-bright gradient at tile UV coordinates.
 * @param {number} u @param {number} v
 * @returns {{ coverage: number, grad: number }}
 */
export function rounded_rect_gradient(u, v) {
  const px = Math.abs(u - 0.5)
  const py = Math.abs(v - 0.5)
  const half = 0.5
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
