// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// D75 DETERMINISTIC VARIED FIGHT GRID.
//
// ⚠️ RUNTIME READS STORED MASKS — `generateGrid` IS A DEV/TEST TWIN, NEVER A RUNTIME PATH. ⚠️
// The THIRD design ask ("shape determined by the move modules, random shape, still playable") is implemented
// STORE-don't-twin: the CONTRACT generates + STORES the full board (shape_mask/obstacles/holes/dims/start_cells)
// and `read_dungeon` decodes it — the LIVE board reads that stored truth via `dungeon_grid_of` below and NEVER
// re-derives the shape. `generateGrid` (+ the shape builders / king-isolation placer) exists ONLY for (a) the
// dev synthetic-board harness (force_fight_board.js) and (b) a JS-side determinism unit test. A train-3 dungeon
// (no stored mask) gets a plain RECT from its OWN stored dims (`legacy_rect_grid`) — there is NO runtime fallback
// to `generateGrid`; a silent generator fallback would reintroduce the exact twin-drift class this design kills.
//
// The generator MIRRORS Move `dungeon_grid::generate` (PRNG = @aresrpg/sim mulberry32; same draw order + shape
// builders + king-isolation) so the dev board looks like a real one — but the Move determinism test is pinned
// Move-NATIVE (dungeon_grid_test.move), NOT against this file, so the two are never a load-bearing contract.
// Cells use the CANONICAL stride-20 encoding (`encode(x,y)=y*20+x`, fight-los GRID_W=20).

import { rng_seed, rng_int, rng_range } from '@aresrpg/sim/prng'
import { board_seed_from_anchor, place_blockers } from '@aresrpg/sim/board_gen'
import {
  MASK_WORDS,
  SHAPE_RECT,
  SHAPE_ROUNDED,
  SHAPE_ELLIPSE,
  SHAPE_CROSS_BOARD as SHAPE_CROSS,
  SHAPE_BLOB,
  mask_get,
  rect_mask,
  ellipse_mask,
  rounded_mask,
  cross_mask,
  blob_mask,
  blocker_placeable,
} from '@aresrpg/sim/combat_grid'

import { GRID_W, GRID_H, GRID_CELLS, encode, decode, bfsPath } from '@aresrpg/fight/los'
import { mob_entity_id } from '@aresrpg/fight/project'

const MASK32 = 0xffffffff
const MIN_W = 7 // min playable width (RECT vocab low bound)
const MAX_W = 17 // max playable width (x reaches 16 < STRIDE 20)
const MIN_H = 7 // min playable height
const MAX_H = 19 // max playable height (the "15x19" tall case)
const MAX_SEATS = 6 // one start cell emitted per potential seat, per side
const OBS_MIN = 2 // obstacle (LOS blocker) count range (maxima)
const OBS_MAX = 6
const HOLE_MIN = 1 // hole (impassable pit) count range
const HOLE_MAX = 4
const N_SHAPES = 4 // BLOB / ROUNDED / ELLIPSE / CROSS (RECT dropped D252)
const FNV_OFFSET = 2166136261 // FNV-1a 32-bit offset basis
const FNV_PRIME = 16777619 // FNV-1a 32-bit prime
const ROOM_MIX = 0x9e3779b1 // golden-ratio odd constant — de-correlates consecutive room_idx before seeding

// D126b — a dungeon mob's per-turn dash BUDGET CEILING, mirrored from dungeon_mob.move `MOB_MP_MAX = 5`
// ("matches combat_mob"). The exact per-turn budget is a Random [1,MOB_MP_MAX] rolled when the mob acts, so the
// client shows the CEILING as the mob's hover MP-reach (the honest "how far it could dash" affordance).
export const MOB_MP_MAX = 5

/**
 * Fold a byte array into a uint32 seed via FNV-1a. Mirrors Move `hash_seed`. `Math.imul` + `>>> 0` reproduce
 * Move's `(h * PRIME) & MASK32` exactly.
 * @param {ArrayLike<number>} bytes @returns {number} uint32
 */
function hash_seed(bytes) {
  let h = FNV_OFFSET
  for (let i = 0; i < bytes.length; i++) {
    h = (h ^ (bytes[i] & 0xff)) >>> 0
    h = Math.imul(h, FNV_PRIME) >>> 0
  }
  return h >>> 0
}
export { hash_seed as hashSeed }

/**
 * Decode a Sui object id (`0x…` hex) into its 32 bytes and fold to the uint32 `dungeon_hash`.
 * @param {string} id @returns {number} uint32
 */
function dungeon_hash_from_id(id) {
  const hex = (id.startsWith('0x') ? id.slice(2) : id).padStart(64, '0')
  const bytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return hash_seed(bytes)
}
export { dungeon_hash_from_id as dungeonHashFromId }

/** min(a,b). */
const min2 = (a, b) => (a < b ? a : b)

/** The candidate enumeration the blocker probe walks (row-major on-mask cells whose 8-ring is on-mask). */
function placeable_candidates(mask) {
  const out = []
  for (let c = 0; c < GRID_CELLS; c++) if (blocker_placeable(mask, [], c)) out.push(c)
  return out
}

// ── GENERATOR (byte-identical draw order to Move `dungeon_grid::generate`) ────────────────────────────────────

/**
 * The playable mask for `shape_code` + params drawn from the rng cursor. Returns { mask, next_state }.
 * @param {number} s @param {number} shape_code @param {number} width @param {number} height
 */
function build_shape(s, shape_code, width, height) {
  const draw = (fn, ...args) => {
    const r = fn(s, ...args)
    s = r.state
    return r.value
  }
  if (shape_code === SHAPE_RECT) return { mask: rect_mask(width, height), state: s }
  if (shape_code === SHAPE_ELLIPSE) return { mask: ellipse_mask(width, height), state: s }
  if (shape_code === SHAPE_ROUNDED) {
    const cap = (min2(width, height) / 3) | 0
    const r = draw(rng_range, 1, cap)
    return { mask: rounded_mask(width, height, r), state: s }
  }
  if (shape_code === SHAPE_CROSS) {
    const bar_h = draw(rng_range, 3, height)
    const bar_w = draw(rng_range, 3, width)
    const ry0 = ((height - bar_h) / 2) | 0
    const cx0 = ((width - bar_w) / 2) | 0
    return { mask: cross_mask(width, height, ry0, ry0 + bar_h, cx0, cx0 + bar_w), state: s }
  }
  // BLOB: rounded rect with FOUR independent corner radii (asymmetric/organic). cap = min(w,h)/3 (same as rounded);
  // FOUR draws IN ORDER (tl,tr,bl,br) — mirrors Move build_shape's blob branch byte-for-byte.
  const cap = (min2(width, height) / 3) | 0
  const r_tl = draw(rng_range, 1, cap)
  const r_tr = draw(rng_range, 1, cap)
  const r_bl = draw(rng_range, 1, cap)
  const r_br = draw(rng_range, 1, cap)
  return { mask: blob_mask(width, height, r_tl, r_tr, r_bl, r_br), state: s }
}

/** The on-mask unblocked cells (row-major) — the start-cell pool. */
function open_cells(mask, blocked) {
  const out = []
  for (let c = 0; c < GRID_CELLS; c++) if (mask_get(mask, c) && !blocked.has(c)) out.push(c)
  return out
}

/** Normalize the canonical u64-word mask for frontend Set consumers. */
function mask_cells(mask) {
  const cells = new Set()
  for (let c = 0; c < GRID_CELLS; c++) if (mask_get(mask, c)) cells.add(c)
  return cells
}

/** Pick `count` start cells from `pool` at the near (from_top) or far end, disjoint from `used`. */
function pick_starts(pool, count, from_top, used) {
  const out = []
  const used_set = new Set(used)
  const n = pool.length
  for (let k = 0; k < n && out.length < count; k++) {
    const idx = from_top ? k : n - 1 - k
    const cell = pool[idx]
    if (!used_set.has(cell) && !out.includes(cell)) out.push(cell)
  }
  return out
}

/** Serialize an on-cell Set to the Move-identical MASK_WORDS×u64 word vector (as JS numbers via BigInt). */
function mask_words(mask_set) {
  const words = new Array(MASK_WORDS).fill(0n)
  for (const c of mask_set) {
    const w = (c / 64) | 0
    words[w] |= 1n << BigInt(c % 64)
  }
  // return as decimal strings? No — the parity test compares against Move u64 vectors as numbers. u64 exceeds
  // JS safe int, so we return BigInt values; the parity-capture script stringifies them for the Move literals.
  return words
}
export { mask_words as maskWords }

/**
 * Deterministically generate a D75 fight board from `(dungeon_hash, room_idx)`. PURE. Byte-identical to Move
 * `dungeon_grid::generate`. Returns the layout in the CANONICAL stride-20 encoding.
 * @param {number} dungeonHash uint32 @param {number} roomIdx
 * @returns {{ width, height, shape_mask: Set<number>, obstacles: number[], holes: number[], start_cells_a: number[], start_cells_b: number[] }}
 */
function generate_grid(dungeon_hash, room_idx) {
  const mixed = Math.imul((room_idx + 1) >>> 0, ROOM_MIX) >>> 0
  let s = rng_seed((((dungeon_hash & MASK32) >>> 0) ^ mixed) >>> 0)
  const draw = (fn, ...args) => {
    const r = fn(s, ...args)
    s = r.state
    return r.value
  }

  // 1. dims
  const width = draw(rng_range, MIN_W, MAX_W)
  const height = draw(rng_range, MIN_H, MAX_H)

  // 2. shape code + params → mask
  // D252: VOCAB drops plain RECT (the "square blob") and adds the organic BLOB; same rng_int(s,4) draw,
  // the index maps through the vocab. Order fixed — mirrors Move dungeon_grid::generate byte-for-byte.
  const VOCAB = [SHAPE_BLOB, SHAPE_ROUNDED, SHAPE_ELLIPSE, SHAPE_CROSS]
  const shape_code = VOCAB[draw(rng_int, N_SHAPES)]
  const shaped = build_shape(s, shape_code, width, height)
  s = shaped.state
  const mask = shaped.mask

  // 3. blockers — obstacles first, then holes (see the obstacles → king-isolated from them too)
  const candidates = placeable_candidates(mask)
  const obs_count = draw(rng_range, OBS_MIN, OBS_MAX)
  const obs_set = new Set()
  s = place_blockers(s, candidates, obs_count, cand => {
    if (obs_set.has(cand) || !blocker_placeable(mask, [...obs_set], cand)) return false
    obs_set.add(cand)
    return true
  })
  const obstacles = [...obs_set]

  const hole_count = draw(rng_range, HOLE_MIN, HOLE_MAX)
  const holes_buf = new Set(obs_set) // seed with obstacles so holes stay king-isolated from them…
  s = place_blockers(s, candidates, hole_count, cand => {
    if (holes_buf.has(cand) || !blocker_placeable(mask, [...holes_buf], cand)) return false
    holes_buf.add(cand)
    return true
  })
  const holes = [...holes_buf].filter(c => !obs_set.has(c)) // …then split holes back out (order-preserving)

  // 4. start cells — 6/side, on-mask, unblocked, opposite bands
  const blocked = new Set([...obstacles, ...holes])
  const pool = open_cells(mask, blocked)
  const start_cells_a = pick_starts(pool, MAX_SEATS, true, [])
  const start_cells_b = pick_starts(pool, MAX_SEATS, false, start_cells_a)

  return { width, height, shape_mask: mask_cells(mask), obstacles, holes, start_cells_a, start_cells_b }
}
export { generate_grid as generateGrid }

// ── FIGHT-BOARD FROM ANCHOR (the ENGINE Fight's board — world_seed + spawn anchor) ───────────────────────────
// A world/dungeon engine Fight stores its board as a `shape_mask` u64 BITSET (combat_grid: 1 bit/cell, 6 words).
// Those words EXCEED JS's 2^53 safe-integer bound, so @aresrpg/sdk's `Number()`-based decode is LOSSY (a real
// 14×14 mask drops ~11 cells → phantom voids). The SEED inputs decode LOSSLESSLY (world_seed u64 via BigInt,
// anchor u32), so the mask is REGENERATED here from (world_seed, anchor) via `generateGrid` — which mirrors
// `board::generate` byte-for-byte (variant 0 = every fight; `generateGrid(seed,0)` ≡ `board::generate(seed,0)`,
// same draw order + shapes). Only the unreadable mask is twinned; obstacles/holes/starts/dims stay chain-STORED
// truth (their cell-index decode is lossless). SSOT twins — NEVER reorder a draw: board.move:61-63 (the fold) /
// sim board_gen.js / engine board_anchor.js.
//
// #1680 — the FOLD is IMPORTED, never re-declared. This file used to carry its own `board_seed_from_anchor`
// with its own PRIME_X/PRIME_Z literals: a second independently-typed home for a chain-twin fold, where one
// digit of drift silently desyncs every generated board from the chain. `@aresrpg/sim/board_gen` owns it (the
// fixture-pinned Move twin); the anchors it is handed must be integers, exactly as the chain's u32 params are —
// the sim fold throws on a non-integer rather than silently truncating one into a different board.

/** The deterministic engine-Fight board for (world_seed, spawn anchor), variant 0 — byte-identical to the layout
 *  `board::generate_for_anchor` produced on-chain. Returns generateGrid's normalized shape (canonical stride-20
 *  Set mask + cell-index lists). Null when the seed inputs are absent (never regenerate from a missing seed).
 *  @param {number|bigint|null|undefined} world_seed @param {number} anchor_x @param {number} anchor_z */
export function board_shape_from_anchor(world_seed, anchor_x, anchor_z) {
  if (world_seed == null) return null
  return generate_grid(board_seed_from_anchor(world_seed, anchor_x, anchor_z), 0)
}

// ── LIVE-BOARD GLUE (reads the STORED layout from a live dungeon; falls back to generateGrid ONLY for a train-3
//    dungeon that stored no mask — shape-tolerant cutover, the data is the flag) ──────────────────────────────

/**
 * The room grid for a LIVE dungeon: the STORED shape (mask/obstacles/holes/dims) `read_dungeon` decoded (canonical
 * stride-20), memoized per (id, room). D75 — the client READS the board; it no longer re-derives the shape. A
 * train-3 dungeon (no stored mask) has `dungeon.shape_mask` empty → fall back to the seed-derived rectangle so the
 * OLD client keeps working against the live train-3 chain (mask absent ⇒ today's rectangle behavior).
 * @param {any} dungeon a normalized dungeon (read_dungeon) — carries shape_mask (Set), obstacles, holes, grid_*, stride
 */
let _grid_cache = /** @type {{ key: string | null, grid: any }} */ ({ key: null, grid: null })
export function dungeon_grid_of(dungeon) {
  // HOLD-NOT-DEGRADE (never fall back when a proper system is missing data): a record without its
  // PROVEN grid dims is NOT PRESENTABLE — return the null hold, never an invented frame (the old
  // `grid_width || 10` fallback painted a phantom 10×10 board with synthesized placement for a torn/gridless
  // record). The adoption fold upstream (fight_geometry_complete) refuses such records before they present,
  // so a null here surfaces a pipeline bug loudly instead of drawing one.
  const proven = Number(dungeon.grid_width) > 0 && Number(dungeon.grid_height) > 0
  // D75-stride: the grid is DATA-derived now (not seed-derived), and the data CHANGES under one id#room —
  // a fresh dungeon reads mask-EMPTY at OPEN, then start_room stores the room's mask while room_index is
  // still the same. Fold the stored-shape identity (mask size + dims) into the key or an earlier-served
  // shape (the OPEN-time rect, a held null) would be served STALE into PLACEMENT (wrong rings → EBadStartCell).
  const mask_size = dungeon.shape_mask instanceof Set ? dungeon.shape_mask.size : (dungeon.shape_mask?.length ?? 0)
  const key = `${dungeon.id}#${dungeon.room_index}#${mask_size}#${dungeon.grid_width}x${dungeon.grid_height}`
  if (_grid_cache.key === key) return _grid_cache.grid
  let grid
  if (!proven) {
    grid = null
  } else if (dungeon.shape_mask instanceof Set ? dungeon.shape_mask.size > 0 : dungeon.shape_mask?.length > 0) {
    // TRAIN-4: the stored mask IS the board. Everything is already canonical stride-20 (read_dungeon normalized).
    const mask = dungeon.shape_mask instanceof Set ? dungeon.shape_mask : new Set(dungeon.shape_mask)
    grid = {
      width: dungeon.grid_width,
      height: dungeon.grid_height,
      shape_mask: mask,
      obstacles: dungeon.obstacles ?? [],
      holes: dungeon.holes ?? [],
      start_cells_a: dungeon.start_cells_a ?? [],
      start_cells_b: dungeon.start_cells_b ?? [],
    }
  } else {
    // TRAIN-3 rect: no stored mask but PROVEN stored dims → the honest [0,width)×[0,height) rectangle (the
    // client already normalized train-3 chain cells to canonical stride-20, so the rect matches the train-3
    // out_of_bounds walls under either stride).
    grid = legacy_rect_grid(dungeon)
  }
  _grid_cache = { key, grid }
  return grid
}

/**
 * TRAIN-3 rectangle grid: a plain [0,width)×[0,height) mask from the STORED dims — only ever reached with
 * PROVEN dims (dungeon_grid_of holds gridless records as null; the `|| 10` dims
 * invention). This preserves the exact pre-D75 walkability (rect walls) for a live train-3 fight.
 * D75-stride: a legacy record also stores NO start lists — resurrect the exact pre-D75 placement rule for it
 * (spawn rows y<2 ∩ walkable, centre-ranked 6 — the old D83 cluster) so placement keeps working against the live
 * train-3 chain during the pre-republish window. The stored-list path (train-4) never enters this branch.
 * @param {any} dungeon
 */
function legacy_rect_grid(dungeon) {
  const width = dungeon.grid_width
  const height = dungeon.grid_height
  const mask = mask_cells(rect_mask(width, height))
  let start_cells_a = dungeon.start_cells_a ?? []
  const start_cells_b = dungeon.start_cells_b ?? []
  if (!start_cells_a.length && !start_cells_b.length) {
    // the D83 centre cluster, verbatim from the retired center_start_cells: walkable spawn-row cells ranked by
    // |x − centre column|, ties → nearer row then lower x (deterministic, no RNG), take 6.
    const walls = new Set([...(dungeon.obstacles ?? []), ...(dungeon.holes ?? [])])
    const cx = (width - 1) / 2
    start_cells_a = [...mask]
      .map(cell => ({ cell, ...decode(cell) }))
      .filter(({ cell, y }) => y < 2 && !walls.has(cell))
      .sort((a, b) => Math.abs(a.x - cx) - Math.abs(b.x - cx) || a.y - b.y || a.x - b.x)
      .slice(0, 6)
      .map(r => r.cell)
  }
  return {
    width,
    height,
    shape_mask: mask,
    obstacles: dungeon.obstacles ?? [],
    holes: dungeon.holes ?? [],
    start_cells_a,
    start_cells_b,
  }
}

/**
 * The STATIC movement-wall set of a grid: ¬shape_mask ∪ obstacles ∪ holes — the first appends of Move
 * `dungeon::move_blocked_cells` (the living-fighter cells are added per-mover by the callers). Every cell NOT on
 * the mask is a wall (the room SHAPE), replacing the old out-of-bounds rectangle logic.
 * @param {{ shape_mask: Set<number>, obstacles: number[], holes: number[] }} grid @returns {Set<number>}
 */
function wall_cells({ shape_mask, obstacles, holes }) {
  const mask = shape_mask instanceof Set ? shape_mask : new Set(shape_mask)
  const walls = new Set()
  for (let c = 0; c < GRID_CELLS; c++) if (!mask.has(c)) walls.add(c)
  for (const c of obstacles) walls.add(c)
  for (const c of holes) walls.add(c)
  return walls
}
export { wall_cells as wallCells }

/**
 * The contract's LEGAL PLAYER PLACEMENT set: the STORED start cells (both team bands, on-mask + unblocked by
 * construction). D75 — replaces the old `is_start_cell` (y<2) ∩ walkable derivation; the picker paints EXACTLY the
 * stored list so a ring is never drawn on a cell the contract would reject (EBadStartCell).
 * @param {{ start_cells_a: number[], start_cells_b: number[] }} grid @returns {number[]}
 */
export function start_cells_of(grid) {
  return [...(grid.start_cells_a ?? []), ...(grid.start_cells_b ?? [])]
}

/**
 * The placement set the player may pick during PLACEMENT — the STORED start list (both bands). D75: the stored
 * lists ARE the tight, shape-relative, contract-accepted cluster (the old D83 centre-ranking is absorbed into the
 * generator's start-cell pick). Both the 3D rings and the click gate read THIS single source.
 * @param {any} dungeon @returns {number[]}
 */
export function placement_cells_of(dungeon) {
  return start_cells_of(dungeon_grid_of(dungeon))
}

/**
 * The MOVEMENT wall set for BFS, twinning `dungeon::move_blocked_cells(exclude)`: static walls (¬mask ∪ obstacles ∪
 * holes) ∪ every OTHER living fighter's cell (body-blocking). The mover (`exclude_id`) never blocks itself.
 *
 * `also_vacated` (a mover must be able to walk onto a cell where a mob just died): a Set of ENCODED cells the caller knows are
 * ALREADY freed by this turn's uncommitted draft — a mob the drafted casts kill when those casts commit BEFORE the
 * moves (cast_first: DungeonBoard ships `[...casts, ...moves]`, and the chain's `cast::move_blocked_cells` remasks
 * over LIVING mobs only per apply_move, so the kill has already vacated the cell by the time my move applies). The
 * `dungeon` view still reads that mob `alive` until the next poll, so without this the move-gate refuses a cell the
 * commit would accept. Only pass cells the commit ORDER guarantees are vacated first (cast_first) — never a
 * move-first draft, where the chain still blocks (EIllegalMove). Absent ⇒ pure chain truth (every existing caller).
 * @param {any} dungeon @param {string} exclude_id @param {Set<number>|null} [also_vacated] @returns {Set<number>}
 */
export function dungeon_blocked_cells(dungeon, exclude_id, also_vacated = null) {
  const blocked = new Set(wall_cells(dungeon_grid_of(dungeon)))
  for (const p of dungeon.escrow) {
    const participant_id = p.character ?? p.character_id ?? p.addr
    if (p.alive && participant_id !== exclude_id) blocked.add(p.cell)
  }
  dungeon.mobs.forEach((m, i) => {
    if (m.alive && mob_entity_id(i) !== exclude_id && !also_vacated?.has(m.cell)) blocked.add(m.cell)
  })
  return blocked
}

/**
 * D125 — the LEGAL cell-by-cell walk for a moved fighter, as the replay should ANIMATE it: a 4-connected BFS route
 * around `dungeon_blocked_cells`. DISPLAY-ONLY (the chain endpoint stays truth; only the in-between SHAPE is a
 * client choice). Returns encoded cells EXCLUDING the start, or `[]` when start==target / no legal route.
 * @param {any} dungeon @param {string} exclude_id @param {number} from_enc @param {number} to_enc @returns {number[]}
 */
export function legal_move_path(dungeon, exclude_id, from_enc, to_enc) {
  if (from_enc === to_enc) return []
  const blocked = dungeon_blocked_cells(dungeon, exclude_id)
  return bfsPath(from_enc, to_enc, blocked, GRID_CELLS)
}
