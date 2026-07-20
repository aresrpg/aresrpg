// BOARD — deterministic fight-board derivation: (world_seed, anchor) → board layout. A mirror of
// aresrpg_fight::board.move (S-16 parity). PURE — seed only, no time / IO / stored roll. This module owns the
// DRAW ORDER, which IS the cross-language contract: NEVER reorder / insert / remove a draw without mirroring
// the Move twin. Reuses the shared `prng.js` (proven byte-identical to prng.move) and `combat_grid.js` geometry.
//
// The derivation:
//   1. board_seed = board_seed_from_anchor(world_seed, anchor_x, anchor_z): mix world_seed with the two anchor
//      primes, mask to 32 bits. (BigInt: anchor·PRIME overflows 2^53 before the mask, so the fold is exact.)
//   2. variant de-correlation: mixed2 = (variant+1)·ROOM_MIX & M32; seed the prng with board_seed ^ mixed2.
//   3. width, height ← rng_range. 4. shape ← vocab[rng_int]; build_shape draws its params IN ORDER.
//   5. obstacles first (they become the "blocked" set holes see), then holes; both king-isolated.
//   6. start cells: 6/side, on-mask, unblocked, opposite bands (A near / B far).
//
// PARITY NOTE: the prng LAYER is proven-identical; this derivation is mirrored from a careful static read of
// board.move. The Move pure_tests assert only PROPERTIES (determinism, bounds, 6 disjoint start cells), so
// bit-exact literal parity: PROVEN 2026-07-08 — fight/tests/pure_tests.move::board_dump_for_js_parity dumps the
// property tests here replicate the Move asserts verbatim, and golden JS literals guard against silent drift.

import { rng_seed, rng_int, rng_range } from './prng.js'
import {
  grid_cells,
  mask_get,
  blocker_placeable,
  rect_mask,
  ellipse_mask,
  rounded_mask,
  cross_mask,
  blob_mask,
  shape_rect,
  shape_ellipse,
  shape_rounded,
  shape_cross,
  shape_blob,
} from './combat_grid.js'

const MASK32 = 0xffffffffn

const MIN_W = 7
const MAX_W = 17
const MIN_H = 7
const MAX_H = 19
const MAX_SEATS = 6
const OBS_MIN = 2
const OBS_MAX = 6
const HOLE_MIN = 1
const HOLE_MAX = 4
const N_SHAPES = 4 // BLOB / ROUNDED / ELLIPSE / CROSS
const ROOM_MIX = 0x9e3779b1n
const PRIME_X = 0x85ebca77n
const PRIME_Z = 0xc2b2ae3dn

/**
 * Fold (world_seed, anchor_x, anchor_z) into a u32 board seed. BigInt throughout: anchor·PRIME overflows the JS
 * safe-integer range before masking, so the fold matches Move's u64 arithmetic exactly. Returns a Number in
 * [0, 2^32). Mirrors board::board_seed_from_anchor.
 * @param {number} world_seed @param {number} anchor_x @param {number} anchor_z @returns {number}
 */
export const board_seed_from_anchor = (world_seed, anchor_x, anchor_z) => {
  const ws = BigInt(world_seed) & MASK32
  const ax = (BigInt(anchor_x) * PRIME_X) & MASK32
  const az = (BigInt(anchor_z) * PRIME_Z) & MASK32
  return Number((ws ^ ax ^ az) & MASK32)
}

/**
 * Deterministically generate a fight board from (board_seed, variant). World fights pass variant=0. PURE.
 * Mirrors board::generate. @param {number} board_seed @param {number} variant
 * @returns {{ width:number, height:number, shape_mask:bigint[], obstacles:number[], holes:number[],
 *   start_cells_a:number[], start_cells_b:number[] }}
 */
export const generate = (board_seed, variant) => {
  const mixed = ((BigInt(variant) + 1n) * ROOM_MIX) & MASK32
  let s = rng_seed(Number(((BigInt(board_seed) & MASK32) ^ mixed) & MASK32))

  let r = rng_range(s, MIN_W, MAX_W)
  s = r.state
  const width = r.value
  r = rng_range(s, MIN_H, MAX_H)
  s = r.state
  const height = r.value

  const vocab = [shape_blob(), shape_rounded(), shape_ellipse(), shape_cross()]
  r = rng_int(s, N_SHAPES)
  s = r.state
  const shape_code = vocab[r.value]

  const { state: shape_state, mask } = build_shape(s, shape_code, width, height)
  s = shape_state

  const candidates = placeable_candidates(mask)

  r = rng_range(s, OBS_MIN, OBS_MAX)
  s = r.state
  const obs_count = r.value
  const obstacles = []
  s = place_blockers(s, mask, candidates, obstacles, obs_count)

  r = rng_range(s, HOLE_MIN, HOLE_MAX)
  s = r.state
  const hole_count = r.value
  const holes_work = [...obstacles] // Move: `let mut holes = obstacles` copies
  place_blockers(s, mask, candidates, holes_work, hole_count) // final prng state intentionally unused
  const holes = holes_work.slice(obstacles.length) // tail_after: only the newly-added holes

  const blocked = [...obstacles, ...holes]
  const pool = open_cells(mask, blocked)
  const start_cells_a = pick_starts(pool, MAX_SEATS, true, [])
  const start_cells_b = pick_starts(pool, MAX_SEATS, false, start_cells_a)

  return {
    width,
    height,
    shape_mask: mask,
    obstacles,
    holes,
    start_cells_a,
    start_cells_b,
  }
}

/** Derive a world fight board straight from (world_seed, anchor). Mirrors board::generate_for_anchor. */
export const generate_for_anchor = (world_seed, anchor_x, anchor_z) =>
  generate(board_seed_from_anchor(world_seed, anchor_x, anchor_z), 0)

// ╔════════════════ [ Internals — the frozen draw contract (mirror board.move verbatim) ] ═ ]

const min_u64 = (a, b) => (a < b ? a : b)

/** Build the shape mask for `shape_code`, drawing its per-shape params IN ORDER. Mirrors board::build_shape. */
const build_shape = (s, shape_code, width, height) => {
  if (shape_code === shape_rect()) {
    return { state: s, mask: rect_mask(width, height) }
  } else if (shape_code === shape_ellipse()) {
    return { state: s, mask: ellipse_mask(width, height) }
  } else if (shape_code === shape_rounded()) {
    const cap = Math.floor(min_u64(width, height) / 3)
    const r = rng_range(s, 1, cap)
    return { state: r.state, mask: rounded_mask(width, height, r.value) }
  } else if (shape_code === shape_cross()) {
    const bh = rng_range(s, 3, height)
    const bw = rng_range(bh.state, 3, width)
    const ry0 = Math.floor((height - bh.value) / 2)
    const cx0 = Math.floor((width - bw.value) / 2)
    return {
      state: bw.state,
      mask: cross_mask(width, height, ry0, ry0 + bh.value, cx0, cx0 + bw.value),
    }
  } else {
    const cap = Math.floor(min_u64(width, height) / 3)
    const r_tl = rng_range(s, 1, cap)
    const r_tr = rng_range(r_tl.state, 1, cap)
    const r_bl = rng_range(r_tr.state, 1, cap)
    const r_br = rng_range(r_bl.state, 1, cap)
    return {
      state: r_br.state,
      mask: blob_mask(
        width,
        height,
        r_tl.value,
        r_tr.value,
        r_bl.value,
        r_br.value,
      ),
    }
  }
}

/** Every cell where a blocker COULD legally be placed on an empty board. Mirrors board::placeable_candidates. */
const placeable_candidates = mask => {
  const out = []
  const n = grid_cells()
  for (let c = 0; c < n; c++) {
    if (blocker_placeable(mask, [], c)) out.push(c)
  }
  return out
}

/**
 * Place `count` king-isolated blockers into `out` (mutated in place), probing candidates from a prng-drawn
 * offset with a bounded linear scan. Returns the advanced prng state. Mirrors board::place_blockers.
 * @param {number} s @param {bigint[]} mask @param {number[]} candidates @param {number[]} out @param {number} count
 */
const place_blockers = (s, mask, candidates, out, count) => {
  const len = candidates.length
  if (len === 0) return s
  let placed = 0
  while (placed < count) {
    const drawn = rng_int(s, len)
    s = drawn.state
    const idx0 = drawn.value
    let took = false
    for (let j = 0; j < len; j++) {
      const cand = candidates[(idx0 + j) % len]
      if (!out.includes(cand) && blocker_placeable(mask, out, cand)) {
        out.push(cand)
        took = true
        break
      }
    }
    if (!took) break
    placed++
  }
  return s
}

/** Every on-mask, unblocked cell in index order. Mirrors board::open_cells. @param {bigint[]} mask */
const open_cells = (mask, blocked) => {
  const out = []
  const n = grid_cells()
  for (let c = 0; c < n; c++) {
    if (mask_get(mask, c) && !blocked.includes(c)) out.push(c)
  }
  return out
}

/**
 * Pick up to `count` start cells from `pool`, scanning from the top (near band) or bottom (far band), skipping
 * cells in `used`. Mirrors board::pick_starts.
 */
const pick_starts = (pool, count, from_top, used) => {
  const out = []
  const n = pool.length
  let k = 0
  while (k < n && out.length < count) {
    const idx = from_top ? k : n - 1 - k
    const cell = pool[idx]
    if (!used.includes(cell) && !out.includes(cell)) out.push(cell)
    k++
  }
  return out
}
