// COMBAT GRID — pure integer board geometry (cell = y*GRID_W + x), the varied-grid SHAPE VOCABULARY, the
// king-isolation blocker placer, and zone containment. A faithful mirror of the needed subset of
// aresrpg_foundation::combat_grid.move (S-16 parity): the draw-order-relevant geometry `board_gen.js` derives a
// board from, plus the `in_zone` containment `effect_board.js` resolves trap/glyph zones against.
//
// The `shape_mask` is a `vector<u64>` on-chain → an array of 6 BigInt words here (JS bitwise is 32-bit; a u64
// bit board needs BigInt). Bit `cell` lives at word `cell>>6`, bit `cell & 63` — identical layout to Move, so a
// dumped Move mask compares word-for-word. NOT ported (out of scope for the 4 mirrors): BFS pathing, LOS,
// zone_cells for line/tbar/cone, fixed_damage, approach — the fight engine's non-board-derivation surface.

import {
  SHAPE_POINT,
  SHAPE_ALLMAP,
  SHAPE_RING,
  SHAPE_CROSS,
} from './spell_effect.js'

// D75 encoding STRIDE + bounds — cell = y*GRID_W + x. GRID_W=20 is the SSOT stride every reader encodes against.
export const GRID_W = 20
export const GRID_H = 19
export const GRID_CELLS = GRID_W * GRID_H // 380
export const MASK_WORDS = Math.floor((GRID_CELLS + 63) / 64) // 6

// Board SHAPE codes (the generator's vocabulary namespace — distinct from spell_effect's zone shapes).
export const SHAPE_RECT = 0
export const SHAPE_ROUNDED = 1
export const SHAPE_ELLIPSE = 2
export const SHAPE_CROSS_BOARD = 3
export const SHAPE_BLOB = 4
export const shape_rect = () => SHAPE_RECT
export const shape_rounded = () => SHAPE_ROUNDED
export const shape_ellipse = () => SHAPE_ELLIPSE
export const shape_cross = () => SHAPE_CROSS_BOARD
export const shape_blob = () => SHAPE_BLOB

const abs_diff = (a, b) => (a > b ? a - b : b - a)
export const cell_x = cell => cell % GRID_W
export const cell_y = cell => Math.floor(cell / GRID_W)
export const encode = (x, y) => y * GRID_W + x
export const in_grid = cell => cell < GRID_CELLS
export const grid_cells = () => GRID_CELLS

/** MANHATTAN distance (4-directional, no diagonals) — |Δx| + |Δy|. */
export const manhattan = (a, b) =>
  abs_diff(cell_x(a), cell_x(b)) + abs_diff(cell_y(a), cell_y(b))

// ╔════════════════ [ shape_mask — 6 BigInt words, one bit per cell (row-major) ] ═══ ]
/** A fresh all-zero mask (MASK_WORDS words). @returns {bigint[]} */
export const empty_mask = () => new Array(MASK_WORDS).fill(0n)

/** Set bit `cell` (no-op if out of board bound). @param {bigint[]} mask */
export const mask_set = (mask, cell) => {
  if (cell >= GRID_CELLS) return
  const w = Math.floor(cell / 64)
  mask[w] |= 1n << BigInt(cell % 64)
}

/** Is bit `cell` set? false for out-of-board or short mask. @param {bigint[]} mask */
export const mask_get = (mask, cell) => {
  if (cell >= GRID_CELLS) return false
  const w = Math.floor(cell / 64)
  if (w >= mask.length) return false
  return ((mask[w] >> BigInt(cell % 64)) & 1n) === 1n
}

/** Fill row `y`'s cells x∈[lo,hi) (single contiguous run; hi clamped to GRID_W). @param {bigint[]} mask */
const fill_row = (mask, y, lo, hi) => {
  const end = hi > GRID_W ? GRID_W : hi
  for (let x = lo; x < end; x++) mask_set(mask, encode(x, y))
}

/** RECT(w,h): the full [0,w)×[0,h) rectangle. @returns {bigint[]} */
export const rect_mask = (w, h) => {
  const m = empty_mask()
  for (let y = 0; y < h; y++) fill_row(m, y, 0, w)
  return m
}

/** ELLIPSE(w,h): filled axis-aligned ellipse, doubled-coord integer inequality (2Δx)²h² + (2Δy)²w² ≤ (wh)². */
export const ellipse_mask = (w, h) => {
  const m = empty_mask()
  const cx2 = w - 1
  const cy2 = h - 1
  const rhs = w * h * (w * h)
  for (let y = 0; y < h; y++) {
    const dy2 = abs_diff(2 * y, cy2)
    const ty = dy2 * dy2 * (w * w)
    let lo = w // sentinel "empty"
    let hi = 0
    for (let x = 0; x < w; x++) {
      const dx2 = abs_diff(2 * x, cx2)
      if (dx2 * dx2 * (h * h) + ty <= rhs) {
        if (x < lo) lo = x
        if (x + 1 > hi) hi = x + 1
      }
    }
    if (lo < hi) fill_row(m, y, lo, hi)
  }
  return m
}

/** ROUNDED(w,h,r): RECT with four corners bevelled by a quarter-arc of radius r. r==0 → RECT. */
export const rounded_mask = (w, h, r) => {
  if (r === 0) return rect_mask(w, h)
  const m = empty_mask()
  const arc = (r - 1) * (r - 1)
  for (let y = 0; y < h; y++) {
    const in_band = y < r || y >= h - r
    const dy = y < r ? r - 1 - y : y >= h - r ? y - (h - r) : 0
    let cut = 0
    if (in_band) {
      for (let k = 0; k < r; k++) {
        const dx = r - 1 - k
        if (dx * dx + dy * dy > arc) cut = k + 1
        else break
      }
    }
    fill_row(m, y, cut, w - cut)
  }
  return m
}

/** Cells cut from ONE horizontal end of row `y` by a quarter-arc corner of radius `r`. Mirrors corner_cut. */
const corner_cut = (r, y, h, top) => {
  if (r === 0) return 0
  const in_band = top ? y < r : y >= h - r
  if (!in_band) return 0
  const dy = top ? r - 1 - y : y - (h - r)
  const arc = (r - 1) * (r - 1)
  let cut = 0
  for (let k = 0; k < r; k++) {
    const dx = r - 1 - k
    if (dx * dx + dy * dy > arc) cut = k + 1
    else break
  }
  return cut
}

/** BLOB(w,h,r_tl,r_tr,r_bl,r_br): rounded rect with four independent corner radii (per-row max of the two ends). */
export const blob_mask = (w, h, r_tl, r_tr, r_bl, r_br) => {
  const m = empty_mask()
  for (let y = 0; y < h; y++) {
    const tl = corner_cut(r_tl, y, h, true)
    const tr = corner_cut(r_tr, y, h, true)
    const bl = corner_cut(r_bl, y, h, false)
    const br = corner_cut(r_br, y, h, false)
    const left = tl > bl ? tl : bl
    const right = tr > br ? tr : br
    fill_row(m, y, left, w - right)
  }
  return m
}

/** CROSS(w,h): horizontal bar rows [ry0,ry1) at full width ∪ vertical bar cols [cx0,cx1) elsewhere. */
export const cross_mask = (w, h, ry0, ry1, cx0, cx1) => {
  const m = empty_mask()
  for (let y = 0; y < h; y++) {
    if (y >= ry0 && y < ry1) fill_row(m, y, 0, w)
    else fill_row(m, y, cx0, cx1)
  }
  return m
}

// ╔════════════════ [ King-move isolation blocker placer ] ══════════════════════════ ]
/**
 * May a blocker (obstacle/hole) go at `cand`? Yes iff `cand` is on-mask, ≥1 cell inside the mask rim (its full
 * 8-ring is on-mask), and NO already-placed `blocked` cell is within Chebyshev-1. Mirrors blocker_placeable.
 * @param {bigint[]} mask
 * @param {number[]} blocked
 */
export const blocker_placeable = (mask, blocked, cand) => {
  if (!mask_get(mask, cand)) return false
  const x = cell_x(cand)
  const y = cell_y(cand)
  if (x === 0 || y === 0 || x + 1 >= GRID_W || y + 1 >= GRID_H) return false
  for (let dy = 0; dy < 3; dy++) {
    const ny = y + dy - 1
    for (let dx = 0; dx < 3; dx++) {
      const nx = x + dx - 1
      const ring = encode(nx, ny)
      if (!mask_get(mask, ring)) return false
      if (ring !== cand && blocked.includes(ring)) return false
    }
  }
  return true
}

// ╔════════════════ [ Zone containment (direction-independent shapes) ] ════════════ ]
/**
 * Is `cell` inside a `(shape,size)` zone anchored at `anchor`? EXACT for point/circle/cross/ring/allmap; line/
 * tbar fall back to the filled lozenge (a placed board zone stores no cast direction). Mirrors combat_grid::in_zone.
 * `shape` is a spell_effect ZONE code.
 */
export const in_zone = (shape, size, anchor, cell) => {
  if (!in_grid(cell)) return false
  if (shape === SHAPE_POINT) return cell === anchor
  if (shape === SHAPE_ALLMAP) return true
  const d = manhattan(anchor, cell)
  if (shape === SHAPE_RING) return d === size
  if (shape === SHAPE_CROSS)
    return (
      d <= size &&
      (cell_x(cell) === cell_x(anchor) || cell_y(cell) === cell_y(anchor))
    )
  return d <= size // circle + line/tbar fallback = filled lozenge
}
