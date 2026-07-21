// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SEAM 2 — BOARD-FROM-ANCHOR (SPEC §7: "the board IS the world").
//
// A world fight's board "generates deterministically from the mob group's position (world seed + spawn
// anchor) — every client derives the identical board, and any fight is reproducible from chain data
// alone." This is the engine side of that contract: (world_config seed, anchor x/z) → the exact inputs
// the SEALED tactical board.build() consumes ({grid_w, grid_h, obstacles, holes, voids, anchor}) + the
// per-side start cells.
//
// ── CANONICAL DERIVATION (S-47): this is a BYTE-IDENTICAL TWIN of the Move side ───────────────────────
// The on-chain FIGHT package (`aresrpg_fight::board`, byte-identical in the merged `aresrpg::board`) is THE
// canonical generator; this file mirrors it step-for-step over the SAME stride-20 grid. The board seed is the
// chain's ARITHMETIC fold, NOT a string hash — `board_seed_from_anchor(world_seed, x, z)` =
//   ((world_seed & MASK32) ^ ((x·PRIME_X) & MASK32) ^ ((z·PRIME_Z) & MASK32)) & MASK32   (board.move:61-63)
// then `generate(board_seed, variant=0)` XORs (variant+1)·ROOM_MIX before `rng_seed` (board.move:67-69). The
// world seed is the CHAIN u64 (an explicit param — the engine's string `world_config.seed` is NOT it); anchors
// are signed world-integers reduced mod 2^32 by the &MASK32 folds, matching the chain's u32 params.
//   SSOT twins (do NOT reorder a draw without mirroring all):
//     • packages/move/fight/sources/board.move             (board_seed_from_anchor / generate / build_shape)
//     • packages/move/foundation/sources/combat_grid.move  (mask builders / blocker_placeable / bit order)
//     • packages/sim/src/board_gen.js                      (the Move-proven JS twin; cross-checked in the test)
//   Draw order (after `s = rng_seed((board_seed & M32) ^ ((variant+1)·ROOM_MIX & M32))`):
//     1. width  = rng_range(s, MIN_W, MAX_W)
//     2. height = rng_range(s, MIN_H, MAX_H)
//     3. shape  = VOCAB[rng_int(s, N_SHAPES)]  (BLOB / ROUNDED / ELLIPSE / CROSS) then its param draws
//     4. obstacles: rng_range(s, OBS_MIN, OBS_MAX), then king-isolated placement (rng_int per pick)
//     5. holes:     rng_range(s, HOLE_MIN, HOLE_MAX), then the same placer seeded with the obstacles
//     6. start cells: NO rng — on-shape/unblocked cells row-major; A = 6 near band, B = 6 far band.
//
// CONNECTIVITY BY CONSTRUCTION: every shape is orthogonally convex and every blocker is king-isolated with
// its whole 8-ring on-mask — no blocked curve can wall the region off (combat_grid's proof, unchanged).
//
// Cells are computed in the canonical STRIDE-20 encoding (encode(x,y)=y·20+x — combat_grid GRID_W=20) for
// byte-identity, then DECODED to {x, y} (x=+east, y=+north) for the board.build() spec.

import { rng_seed, rng_int, rng_range } from './prng.js'
import { ground_height } from './ground_height.js'

// Canonical grid stride + bounds — vendored from combat_grid / fight-los.js (GRID_W=20 stride, GRID_H=19
// rows ⇒ 380 cells). Kept here so this module stays three-free (headless-testable) and self-contained.
const GRID_W = 20
const GRID_H = 19
const GRID_CELLS = GRID_W * GRID_H // 380
const MIN_W = 7
const MAX_W = 17
const MIN_H = 7
const MAX_H = 19
const OBS_MIN = 2
const OBS_MAX = 6
const HOLE_MIN = 1
const HOLE_MAX = 4
const MAX_SEATS = 6
const N_SHAPES = 4
// shape codes (mirror combat_grid::shape_*)
const SHAPE_ROUNDED = 1
const SHAPE_ELLIPSE = 2
const SHAPE_CROSS = 3
const SHAPE_BLOB = 4
// D252 vocab — RECT dropped ("square blob"), organic BLOB added; index maps through this fixed order.
const VOCAB = [SHAPE_BLOB, SHAPE_ROUNDED, SHAPE_ELLIPSE, SHAPE_CROSS]
/** World meters per cell — the tactical board's DEFAULT_CELL_SIZE (board.js). Local const keeps this
 *  module three-free; pass `cell_size` if the board uses another. */
const CELL_SIZE_DEFAULT = 2

// Chain fold constants — board::board_seed_from_anchor / generate (aresrpg_fight::board; byte-identical in the
// merged aresrpg::board). u64 math in BigInt (anchor·PRIME overflows 2^53 before &MASK32), downcast to uint32.
const MASK32 = 0xffffffffn
const ROOM_MIX = 0x9e3779b1n // (variant+1)·ROOM_MIX de-correlates a reuse index before seeding (world fight = variant 0)
const PRIME_X = 0x85ebca77n // anchor-x fold prime
const PRIME_Z = 0xc2b2ae3dn // anchor-z fold prime

const encode = (/** @type {number} */ x, /** @type {number} */ y) => y * GRID_W + x
const decode = (/** @type {number} */ c) => ({ x: c % GRID_W, y: Math.floor(c / GRID_W) })

/** @typedef {{ x: number, y: number }} Cell */

/**
 * @typedef {object} BoardSpecForAnchor
 * @property {number} seed the derived uint32 board seed (board_seed_from_anchor) — the (world_seed, anchor) fold
 * @property {{ grid_w: number, grid_h: number, obstacles: Cell[], holes: Cell[], voids: Cell[],
 *   anchor: { origin: { x: number, y: number, z: number } } }} spec the exact board.build() input
 * @property {Cell[]} start_cells_a team-A (near-band) seats — NOT a board.build() field
 * @property {Cell[]} start_cells_b team-B (far-band) seats
 */

/**
 * Fold (world_seed, anchor_x, anchor_z) into a uint32 board seed — the chain's `board::board_seed_from_anchor`
 * (board.move:61-63), NOT a string hash. BigInt throughout: anchor·PRIME overflows JS's safe-integer range
 * before the &MASK32, so the fold matches Move's u64 arithmetic exactly; the result downcasts to a uint32
 * Number. Anchors are signed world-INTEGERS — the &MASK32 folds reduce them mod 2^32, matching the chain's u32
 * params (a negative anchor's two's-complement u32). Mirrors packages/sim/src/board_gen.js.
 * @param {number|bigint} world_seed the CHAIN u64 world seed
 * @param {number} anchor_x integer world-x @param {number} anchor_z integer world-z @returns {number} uint32
 */
export function board_seed_from_anchor(world_seed, anchor_x, anchor_z) {
  const ws = BigInt(world_seed) & MASK32
  const ax = (BigInt(anchor_x) * PRIME_X) & MASK32
  const az = (BigInt(anchor_z) * PRIME_Z) & MASK32
  return Number((ws ^ ax ^ az) & MASK32)
}

/**
 * Derive a deterministic fight board from the CHAIN world seed + spawn anchor. Same (world_seed, anchor) →
 * identical spec on every machine and byte-identical to the on-chain FIGHT twin `board::generate_for_anchor`
 * (aresrpg_fight::board); a different anchor (even 1 block) → a different board.
 * @param {import('../config/world_gen_config.js').WorldGenConfig | null | undefined} world_config the world
 *   recipe — used ONLY by the Y-oracle to ground the board floor (no longer the seed source).
 * @param {number|bigint} world_seed the CHAIN u64 world seed (the canonical on-chain value — the engine's
 *   string `world_config.seed` is a different thing and is NOT used for the board derivation).
 * @param {number} anchor_x integer world-x of the mob-group anchor
 * @param {number} anchor_z integer world-z of the mob-group anchor
 * @param {number} [cell_size] world meters per board cell (default 2) — must match the board's cell_size.
 * @returns {BoardSpecForAnchor}
 */
export function board_spec_for_anchor(world_config, world_seed, anchor_x, anchor_z, cell_size = CELL_SIZE_DEFAULT) {
  const ax = Math.floor(anchor_x)
  const az = Math.floor(anchor_z)
  const seed = board_seed_from_anchor(world_seed, ax, az)
  const { grid_w, grid_h, mask, obstacles, holes, start_a, start_b } = generate(seed, 0)

  // voids = cells of the grid_w×grid_h bounding box that are OFF the shape mask (board.build renders none).
  const voids = []
  for (let y = 0; y < grid_h; y += 1)
    for (let x = 0; x < grid_w; x += 1) if (!mask.has(encode(x, y))) voids.push({ x, y })

  const origin = {
    x: ax - Math.floor((grid_w * cell_size) / 2),
    y: ground_height(world_config, ax, az),
    z: az - Math.floor((grid_h * cell_size) / 2),
  }

  return {
    seed,
    spec: { grid_w, grid_h, obstacles: obstacles.map(decode), holes: holes.map(decode), voids, anchor: { origin } },
    start_cells_a: start_a.map(decode),
    start_cells_b: start_b.map(decode),
  }
}

/**
 * ADAPTER (bitset → voids list) — for S-18's wiring. The chain stores a board's playable region as a
 * `shape_mask: vector<u64>` BITSET: combat_grid encodes cell = y·GRID_W + x (stride 20), and bit `cell` lives
 * at word `cell >> 6`, position `cell & 63`, LSB-first (combat_grid.move mask_set:183-189 / mask_get:193-198).
 * The SEALED tactical `board.build()` instead consumes a VOIDS cell list — the bounding-box cells that are OFF
 * the mask (drawn as nothing). This converts the chain bitset → that voids list for a grid_w×grid_h board.
 * @param {ArrayLike<bigint|number|string>} shape_mask the chain shape_mask words (each a u64)
 * @param {number} grid_w playable width @param {number} grid_h playable height
 * @returns {Cell[]} the off-mask cells of the [0,grid_w)×[0,grid_h) bounding box (board-local coords)
 */
export function voids_from_shape_mask(shape_mask, grid_w, grid_h) {
  const voids = []
  for (let y = 0; y < grid_h; y += 1)
    for (let x = 0; x < grid_w; x += 1) {
      const c = y * GRID_W + x
      const word = BigInt(shape_mask[c >> 6] ?? 0)
      if (((word >> BigInt(c & 63)) & 1n) === 0n) voids.push({ x, y })
    }
  return voids
}

/**
 * TEST/PARITY hook — the raw stride-20 layout for a board_seed (variant 0 by default), matching the field
 * names + encoding of the canonical twins (board::generate / sim board_gen.js). Lets a golden vector prove
 * engine == sim == Move by construction. @param {number} board_seed uint32 @param {number} [variant]
 * @returns {{ grid_w: number, grid_h: number, shape_mask: Set<number>, obstacles: number[], holes: number[], start_cells_a: number[], start_cells_b: number[] }}
 */
export function _generate_board(board_seed, variant = 0) {
  const g = generate(board_seed, variant)
  return {
    grid_w: g.grid_w,
    grid_h: g.grid_h,
    shape_mask: g.mask,
    obstacles: g.obstacles,
    holes: g.holes,
    start_cells_a: g.start_a,
    start_cells_b: g.start_b,
  }
}

/**
 * The board generator — a faithful twin of board::generate (aresrpg_fight::board), seeded from (board_seed,
 * variant): s = rng_seed((board_seed & MASK32) ^ ((variant+1)·ROOM_MIX & MASK32)). World fights pass variant
 * 0. Returns the layout in the stride-20 encoding (the caller decodes to {x,y}). PURE.
 * @param {number} board_seed uint32 @param {number} [variant] reuse index (0 for a world fight)
 * @returns {{ grid_w: number, grid_h: number, mask: Set<number>,
 *   obstacles: number[], holes: number[], start_a: number[], start_b: number[] }}
 */
function generate(board_seed, variant = 0) {
  const mixed = ((BigInt(variant) + 1n) * ROOM_MIX) & MASK32
  let s = rng_seed(Number(((BigInt(board_seed) & MASK32) ^ mixed) & MASK32))
  const draw = (
    /** @type {(state: number, ...a: number[]) => { state: number, value: number }} */ fn,
    /** @type {number[]} */ ...a
  ) => {
    const r = fn(s, ...a)
    s = r.state
    return r.value
  }

  // 1–2. dims
  const grid_w = draw(rng_range, MIN_W, MAX_W)
  const grid_h = draw(rng_range, MIN_H, MAX_H)

  // 3. shape code + params → mask
  const shape_code = VOCAB[draw(rng_int, N_SHAPES)]
  const shaped = build_shape(s, shape_code, grid_w, grid_h)
  s = shaped.state
  const { mask } = shaped

  // 4–5. blockers — obstacles first, then holes (seeded with the obstacles so holes stay king-isolated too)
  const candidates = placeable_candidates(mask)
  const obs_count = draw(rng_range, OBS_MIN, OBS_MAX)
  const obs_set = new Set()
  s = place_blockers(s, mask, candidates, obs_set, obs_count)
  const obstacles = [...obs_set]

  const hole_count = draw(rng_range, HOLE_MIN, HOLE_MAX)
  const holes_buf = new Set(obs_set)
  s = place_blockers(s, mask, candidates, holes_buf, hole_count)
  const holes = [...holes_buf].filter((c) => !obs_set.has(c))

  // 6. start cells — 6/side, on-mask, unblocked, opposite bands
  const blocked = new Set([...obstacles, ...holes])
  const pool = open_cells(mask, blocked)
  const start_a = pick_starts(pool, MAX_SEATS, true, [])
  const start_b = pick_starts(pool, MAX_SEATS, false, start_a)

  return { grid_w, grid_h, mask, obstacles, holes, start_a, start_b }
}

// ── shape geometry (byte-identical twin of combat_grid's mask builders) ──────────────────────────────
/** Fill row `y` cells x∈[lo,hi) into the mask (the convexity primitive). `hi` clamped to GRID_W.
 * @param {Set<number>} mask @param {number} y @param {number} lo @param {number} hi */
function fill_row(mask, y, lo, hi) {
  const end = Math.min(hi, GRID_W)
  for (let x = lo; x < end; x += 1) mask.add(encode(x, y))
}

/** ELLIPSE(w,h): filled axis-aligned ellipse (per-row single run).
 * @param {number} w @param {number} h @returns {Set<number>} */
function ellipse_mask(w, h) {
  const m = new Set()
  const cx2 = w - 1
  const cy2 = h - 1
  const rhs = w * h * (w * h)
  for (let y = 0; y < h; y += 1) {
    const dy2 = Math.abs(2 * y - cy2)
    const ty = dy2 * dy2 * (w * w)
    let lo = w
    let hi = 0
    for (let x = 0; x < w; x += 1) {
      const dx2 = Math.abs(2 * x - cx2)
      if (dx2 * dx2 * (h * h) + ty <= rhs) {
        if (x < lo) lo = x
        if (x + 1 > hi) hi = x + 1
      }
    }
    if (lo < hi) fill_row(m, y, lo, hi)
  }
  return m
}

/** ROUNDED(w,h,r): RECT with quarter-arc corners of radius r trimmed. r=0 → RECT.
 * @param {number} w @param {number} h @param {number} r @returns {Set<number>} */
function rounded_mask(w, h, r) {
  const m = new Set()
  for (let y = 0; y < h; y += 1) {
    const left =
      corner_cut(r, y, h, true) > corner_cut(r, y, h, false) ? corner_cut(r, y, h, true) : corner_cut(r, y, h, false)
    fill_row(m, y, left, w - left)
  }
  return m
}

/** Cells cut from one horizontal end of row `y` by a quarter-arc corner of radius `r`. Integer-only.
 * @param {number} r @param {number} y @param {number} h @param {boolean} top @returns {number} */
function corner_cut(r, y, h, top) {
  if (r === 0) return 0
  const in_band = top ? y < r : y >= h - r
  if (!in_band) return 0
  const dy = top ? r - 1 - y : y - (h - r)
  const arc = (r - 1) * (r - 1)
  let cut = 0
  for (let k = 0; k < r; k += 1) {
    const dx = r - 1 - k
    if (dx * dx + dy * dy > arc) cut = k + 1
    else break
  }
  return cut
}

/** BLOB(w,h,rTl,rTr,rBl,rBr): rounded rect, four independent corner radii (asymmetric/organic).
 * @param {number} w @param {number} h @param {number} r_tl @param {number} r_tr
 * @param {number} r_bl @param {number} r_br @returns {Set<number>} */
function blob_mask(w, h, r_tl, r_tr, r_bl, r_br) {
  const m = new Set()
  for (let y = 0; y < h; y += 1) {
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

/** CROSS(w,h): horizontal bar rows [ry0,ry1) full-width ∪ vertical bar cols [cx0,cx1) full-height.
 * @param {number} w @param {number} h @param {number} ry0 @param {number} ry1
 * @param {number} cx0 @param {number} cx1 @returns {Set<number>} */
function cross_mask(w, h, ry0, ry1, cx0, cx1) {
  const m = new Set()
  for (let y = 0; y < h; y += 1) {
    if (y >= ry0 && y < ry1) fill_row(m, y, 0, w)
    else fill_row(m, y, cx0, cx1)
  }
  return m
}

/** The playable mask for `shape_code` + params drawn from the rng cursor. Returns { mask, state }.
 *  Byte-identical draw order to dungeon_grid::build_shape.
 * @param {number} s @param {number} shape_code @param {number} w @param {number} h
 * @returns {{mask: Set<number>, state: number}} */
function build_shape(s, shape_code, w, h) {
  const draw = (/** @type {any} */ fn, /** @type {number[]} */ ...a) => {
    const r = fn(s, ...a)
    s = r.state
    return r.value
  }
  if (shape_code === SHAPE_ELLIPSE) return { mask: ellipse_mask(w, h), state: s }
  if (shape_code === SHAPE_ROUNDED) {
    const cap = Math.floor(Math.min(w, h) / 3)
    const r = draw(rng_range, 1, cap)
    return { mask: rounded_mask(w, h, r), state: s }
  }
  if (shape_code === SHAPE_CROSS) {
    const bar_h = draw(rng_range, 3, h)
    const bar_w = draw(rng_range, 3, w)
    const ry0 = Math.floor((h - bar_h) / 2)
    const cx0 = Math.floor((w - bar_w) / 2)
    return { mask: cross_mask(w, h, ry0, ry0 + bar_h, cx0, cx0 + bar_w), state: s }
  }
  // BLOB: four independent corner radii, drawn tl,tr,bl,br IN ORDER.
  const cap = Math.floor(Math.min(w, h) / 3)
  const r_tl = draw(rng_range, 1, cap)
  const r_tr = draw(rng_range, 1, cap)
  const r_bl = draw(rng_range, 1, cap)
  const r_br = draw(rng_range, 1, cap)
  return { mask: blob_mask(w, h, r_tl, r_tr, r_bl, r_br), state: s }
}

// ── king-isolated blocker placement (byte-identical twin of combat_grid) ─────────────────────────────
/** May a blocker sit at `cand`? On-mask, ≥1 inside the rim (whole 8-ring on-mask), no `blocked` within
 *  Chebyshev-1. @param {Set<number>} mask @param {Set<number>} blocked @param {number} cand */
function blocker_placeable(mask, blocked, cand) {
  if (!mask.has(cand)) return false
  const x = cand % GRID_W
  const y = Math.floor(cand / GRID_W)
  if (x === 0 || y === 0 || x + 1 >= GRID_W || y + 1 >= GRID_H) return false
  for (let dy = 0; dy < 3; dy += 1)
    for (let dx = 0; dx < 3; dx += 1) {
      const ring = encode(x + dx - 1, y + dy - 1)
      if (!mask.has(ring)) return false
      if (ring !== cand && blocked.has(ring)) return false
    }
  return true
}

/** The candidate enumeration the blocker probe walks (row-major on-mask cells whose 8-ring is on-mask).
 * @param {Set<number>} mask @returns {number[]} */
function placeable_candidates(mask) {
  const out = []
  const empty = new Set()
  for (let c = 0; c < GRID_CELLS; c += 1) if (blocker_placeable(mask, empty, c)) out.push(c)
  return out
}

/** Place up to `count` king-isolated blockers into `out` (holding priors). Returns the next rng state.
 * @param {number} s @param {Set<number>} mask @param {number[]} candidates @param {Set<number>} out
 * @param {number} count @returns {number} */
function place_blockers(s, mask, candidates, out, count) {
  const len = candidates.length
  if (len === 0) return s
  let placed = 0
  while (placed < count) {
    const r = rng_int(s, len)
    s = r.state
    const idx0 = r.value
    let took = false
    for (let j = 0; j < len; j += 1) {
      const cand = candidates[(idx0 + j) % len]
      if (!out.has(cand) && blocker_placeable(mask, out, cand)) {
        out.add(cand)
        took = true
        break
      }
    }
    if (!took) break
    placed += 1
  }
  return s
}

/** The on-mask unblocked cells (row-major) — the start-cell pool.
 * @param {Set<number>} mask @param {Set<number>} blocked @returns {number[]} */
function open_cells(mask, blocked) {
  const out = []
  for (let c = 0; c < GRID_CELLS; c += 1) if (mask.has(c) && !blocked.has(c)) out.push(c)
  return out
}

/** Pick `count` start cells from `pool` at the near (from_top) or far end, disjoint from `used`.
 * @param {number[]} pool @param {number} count @param {boolean} from_top @param {number[]} used
 * @returns {number[]} */
function pick_starts(pool, count, from_top, used) {
  /** @type {number[]} */
  const out = []
  const used_set = new Set(used)
  const n = pool.length
  for (let k = 0; k < n && out.length < count; k += 1) {
    const idx = from_top ? k : n - 1 - k
    const cell = pool[idx]
    if (!used_set.has(cell) && !out.includes(cell)) out.push(cell)
  }
  return out
}
