// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ============================================================================================
// DETERMINISTIC FIGHT-GRID GENERATOR (§6.6, ticket #25) — SHARED SPEC OF RECORD
// ============================================================================================
//
// Given (dungeon_hash, room_index) this derives — NOT authors — a fight arena: grid shape
// (width × height in 4×4-block cells, 10..18 per side), obstacles, holes, and non-overlapping
// start positions for players and mobs. Same inputs ⇒ IDENTICAL bytes on every machine.
//
// ⚠️ STATUS (architect ledger, 2026-07-02): NO Move twin exists yet — an earlier worker's
// "bit-for-bit identical to the Move twin" claim here was FALSE (verified: the live
// combat_grid.move is a FIXED 10×10 with no CA/obstacles/holes, and this module has ZERO
// callers today). This file is the CANDIDATE spec of record for ticket #25: the Move mirror
// ships with the #22-A contract bundle and must reproduce every step below exactly, locked by
// shared test vectors. Until #25 lands, the dungeon stage renders the honest flat 10×10 and
// this module stays intentionally orphaned. Do NOT wire it to the fight UI before the twin.
//
// DETERMINISM LAW (§3.7, stricter §6.6): INTEGER ARITHMETIC ONLY. No Math.random/sin/cos/pow/
// exp/log, no floats anywhere in the derivation path. u64 mixing uses BigInt (exact, portable);
// the per-grid PRNG is a u32 xorshift stream (trivially Move-mirrorable). All loops are bounded.
//
// --------------------------------------------------------------------------------------------
// SEED MIX (mirror this in Move exactly)
// --------------------------------------------------------------------------------------------
// Inputs are folded into one u64 seed word, then reduced to the u32 xorshift state:
//
//   h    = to_u64(dungeon_hash)                       // caller hash, masked to 64 bits
//   r    = to_u64(room_index)                         // room number, masked to 64 bits
//   s0   = (h ^ 0x9e3779b97f4a7c15) & U64             // golden-ratio constant fold
//   s1   = splitmix64_next(s0)     = (s0 + GAMMA) & U64,  GAMMA = 0x9e3779b97f4a7c15
//   s2   = s1 ^ (r * 0xff51afd7ed558ccd & U64)        // stir room via a 64-bit odd multiplier
//   seed64 = splitmix64_mix(s2)                        // full avalanche (Vigna's finalizer)
//   state32 = (seed64 ^ (seed64 >> 32)) & 0xffffffff   // fold high/low halves → u32
//   if state32 == 0: state32 = 0x1                      // xorshift must never sit at 0
//
// PRNG: 32-bit xorshift ("xorshift32", Marsaglia). One step:
//   x ^= (x << 13) & 0xffffffff
//   x ^= x >> 17
//   x ^= (x << 5)  & 0xffffffff
//   return x        (new state == returned value)
// Bounded value in [0, n): rejection-free modulo — `next() % n` (n small, bias negligible and,
// crucially, DETERMINISTIC; the Move twin uses the identical `% n`).
//
// --------------------------------------------------------------------------------------------
// GRID DERIVATION (mirror this in Move exactly)
// --------------------------------------------------------------------------------------------
// 1. SHAPE:   width  = MIN + (rand() % (MAX - MIN + 1))     // 10..18
//             height = MIN + (rand() % (MAX - MIN + 1))     // 10..18
// 2. SEED FILL: for each cell in row-major (y outer, x inner) order draw one rand();
//             cell is a WALL if (rand() % 100) < FILL_PERCENT (45). Border cells forced WALL.
// 3. CELLULAR AUTOMATA: CA_ROUNDS (4) passes of the classic 4/5 rule over an integer bit grid.
//             Neighbours = the 8 Moore cells; out-of-bounds counts as WALL. New state:
//               wall_neighbours >= 5           → WALL
//               wall_neighbours <= 3           → FLOOR       (rule "4/5": 4 stays, escapes both)
//               else (== 4)                    → keep current
//             All cells updated from a snapshot (simultaneous update).
// 4. HOLES:   a SECOND independent bit grid seeded from the SAME stream (drawn AFTER the wall
//             stream) at HOLE_FILL_PERCENT (32), CA-smoothed with the same rule for CA_ROUNDS.
//             A cell becomes a HOLE only where it is FLOOR (not a wall) and the hole grid is 1.
// 5. CONNECTIVITY REPAIR: flood-fill (4-neighbour) from the largest walkable region; every
//             walkable cell NOT in that region is converted to a WALL (obstacle). Deterministic:
//             the seed cell is the first walkable cell of the largest region in scan order.
//             After repair the single connected walkable region is the arena.
// 6. START POSITIONS: walkable cells are enumerated in scan order into a list. Player seats are
//             taken from the FRONT of the list, mob spawns from the BACK, stepping inward, so the
//             two teams start on opposite ends. Picks are guaranteed walkable, in-region, and
//             non-overlapping. If the arena has too few walkable cells for the requested counts
//             the grid is regenerated with a bumped attempt salt (bounded MAX_ATTEMPTS).
//
// Cell byte encoding: 0 = FLOOR (walkable), 1 = OBSTACLE (blocking wall), 2 = HOLE (gap).
// ============================================================================================

import { FIGHT_GRID_CELLS_MIN, FIGHT_GRID_CELLS_MAX } from '../config/world_config.js'

/** Cell byte values (mirror in Move). */
export const CELL_FLOOR = 0
export const CELL_OBSTACLE = 1
export const CELL_HOLE = 2

// ---- Tunable spec constants (any change forks the goldens + bumps the Move twin, §6.6) -------
const FILL_PERCENT = 45 // seed-fill wall probability, in percent
const HOLE_FILL_PERCENT = 32 // seed-fill hole probability, in percent
const CA_ROUNDS = 4 // cellular-automata smoothing passes
const CA_BIRTH_LIMIT = 5 // >= this many wall neighbours ⇒ becomes/stays wall
const CA_DEATH_LIMIT = 3 // <= this many wall neighbours ⇒ becomes/stays floor
const MAX_ATTEMPTS = 8 // bounded regeneration attempts before falling back

const U64_MASK = (1n << 64n) - 1n
const U32_MASK = 0xffffffffn
const GOLDEN_GAMMA = 0x9e3779b97f4a7c15n

// ---- Integer seed mixing (BigInt = exact, portable) -----------------------------------------

/**
 * Coerces an input into a masked 64-bit BigInt. Accepts BigInt, a non-negative integer Number
 * (< 2^53, exact), or a decimal/`0x` hex string. Floats and NaN are rejected — determinism law.
 * @param {bigint | number | string} value
 * @returns {bigint} value & (2^64 - 1)
 */
function to_u64(value) {
  if (typeof value === 'bigint') return value & U64_MASK
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0)
      throw new Error(`fight_grid: expected non-negative integer, got ${value}`)
    return BigInt(value) & U64_MASK
  }
  if (typeof value === 'string') {
    const parsed = value.startsWith('0x') ? BigInt(value) : BigInt(value)
    return parsed & U64_MASK
  }
  throw new Error(`fight_grid: unsupported hash type ${typeof value}`)
}

/**
 * splitmix64 finalizer (Vigna) — full 64-bit avalanche. Pure integer BigInt ops.
 * @param {bigint} z
 * @returns {bigint}
 */
function splitmix64_mix(z) {
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & U64_MASK
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & U64_MASK
  return (z ^ (z >> 31n)) & U64_MASK
}

/**
 * Mixes (dungeon_hash, room_index, attempt) into the initial u32 xorshift state. See the header
 * SEED MIX block — the Move twin must reproduce this word-for-word. `attempt` salts deterministic
 * regeneration; attempt 0 is the canonical grid.
 * @param {bigint | number | string} dungeon_hash
 * @param {number} room_index
 * @param {number} attempt
 * @returns {number} non-zero u32 xorshift seed state
 */
function mix_seed(dungeon_hash, room_index, attempt) {
  const h = to_u64(dungeon_hash)
  const r = (to_u64(room_index) + to_u64(attempt) * 0x2545f4914f6cdd1dn) & U64_MASK
  const s0 = (h ^ GOLDEN_GAMMA) & U64_MASK
  const s1 = (s0 + GOLDEN_GAMMA) & U64_MASK
  const s2 = (s1 ^ ((r * 0xff51afd7ed558ccdn) & U64_MASK)) & U64_MASK
  const seed64 = splitmix64_mix(s2)
  let state = Number((seed64 ^ (seed64 >> 32n)) & U32_MASK) >>> 0
  if (state === 0) state = 1
  return state
}

// ---- u32 xorshift PRNG (Move-mirrorable) ----------------------------------------------------

/**
 * Creates a stateful xorshift32 generator. `next()` advances and returns a u32; `below(n)`
 * returns a value in [0, n) via deterministic modulo.
 * @param {number} seed_state non-zero u32
 * @returns {{ next: () => number, below: (n: number) => number }}
 */
function make_rng(seed_state) {
  let x = seed_state >>> 0
  const next = () => {
    x ^= (x << 13) & 0xffffffff
    x >>>= 0
    x ^= x >>> 17
    x ^= (x << 5) & 0xffffffff
    x >>>= 0
    return x
  }
  const below = (/** @type {number} */ n) => next() % n
  return { next, below }
}

// ---- Grid helpers (integer index math) ------------------------------------------------------

/**
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @returns {number} row-major index
 */
const idx = (x, y, width) => y * width + x

/**
 * Counts wall (value 1) neighbours in the 8-cell Moore neighbourhood; out-of-bounds counts as
 * wall (walls hug the border, keeping arenas enclosed).
 * @param {Uint8Array} grid bit grid (0/1)
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 * @returns {number} 0..8
 */
function count_wall_neighbours(grid, x, y, width, height) {
  let count = 0
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
        count += 1
        continue
      }
      count += grid[idx(nx, ny, width)]
    }
  }
  return count
}

/**
 * Seeds a bit grid from the PRNG: each interior cell is a wall with `fill_percent` probability;
 * every border cell is forced to wall (enclosed arena). Drawn in row-major scan order — the
 * order IS part of the spec (the Move twin draws in the same order).
 * @param {{ below: (n: number) => number }} rng
 * @param {number} width
 * @param {number} height
 * @param {number} fill_percent
 * @returns {Uint8Array} bit grid (0/1)
 */
function seed_bit_grid(rng, width, height, fill_percent) {
  const grid = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const roll = rng.below(100)
      const border = x === 0 || y === 0 || x === width - 1 || y === height - 1
      grid[idx(x, y, width)] = border || roll < fill_percent ? 1 : 0
    }
  }
  return grid
}

/**
 * Runs one 4/5-rule cellular-automata pass, simultaneous update from a snapshot.
 * @param {Uint8Array} grid bit grid (0/1), mutated in place
 * @param {number} width
 * @param {number} height
 */
function ca_step(grid, width, height) {
  const snapshot = grid.slice()
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const walls = count_wall_neighbours(snapshot, x, y, width, height)
      const here = idx(x, y, width)
      if (walls >= CA_BIRTH_LIMIT) grid[here] = 1
      else if (walls <= CA_DEATH_LIMIT) grid[here] = 0
      // walls === 4 → unchanged
    }
  }
}

/**
 * @param {Uint8Array} grid bit grid (0/1)
 * @param {number} width
 * @param {number} height
 */
function ca_smooth(grid, width, height) {
  for (let round = 0; round < CA_ROUNDS; round += 1) ca_step(grid, width, height)
}

// ---- Connectivity (integer flood-fill) ------------------------------------------------------

/**
 * Labels connected walkable regions (4-neighbour) and returns the largest one's membership mask
 * plus its size. A cell is walkable when cells[i] === CELL_FLOOR. Iterative stack — no recursion,
 * bounded by cell count.
 * @param {Uint8Array} cells cell bytes (0/1/2)
 * @param {number} width
 * @param {number} height
 * @returns {{ mask: Uint8Array, size: number }}
 */
function largest_walkable_region(cells, width, height) {
  const total = width * height
  const region = new Int32Array(total).fill(-1)
  const stack = new Int32Array(total)
  let best_id = -1
  let best_size = 0
  let best_first = -1
  let region_id = 0

  for (let start = 0; start < total; start += 1) {
    if (cells[start] !== CELL_FLOOR || region[start] !== -1) continue
    let sp = 0
    stack[sp++] = start
    region[start] = region_id
    let size = 0
    let first = start
    while (sp > 0) {
      const cur = stack[--sp]
      size += 1
      if (cur < first) first = cur
      const cx = cur % width
      const cy = (cur - cx) / width
      // 4-neighbourhood
      const neighbours = [
        cx > 0 ? cur - 1 : -1,
        cx < width - 1 ? cur + 1 : -1,
        cy > 0 ? cur - width : -1,
        cy < height - 1 ? cur + width : -1,
      ]
      for (const nb of neighbours) {
        if (nb < 0) continue
        if (cells[nb] === CELL_FLOOR && region[nb] === -1) {
          region[nb] = region_id
          stack[sp++] = nb
        }
      }
    }
    if (size > best_size || (size === best_size && first < best_first)) {
      best_size = size
      best_id = region_id
      best_first = first
    }
    region_id += 1
  }

  const mask = new Uint8Array(total)
  if (best_id >= 0) for (let i = 0; i < total; i += 1) if (region[i] === best_id) mask[i] = 1
  return { mask, size: best_size }
}

/**
 * Repairs connectivity: keeps the largest walkable region walkable, converts every other
 * walkable (orphan) cell into an OBSTACLE. Holes are left as-is (already non-walkable).
 * @param {Uint8Array} cells cell bytes, mutated in place
 * @param {number} width
 * @param {number} height
 * @returns {number} size of the surviving walkable region
 */
function repair_connectivity(cells, width, height) {
  const { mask, size } = largest_walkable_region(cells, width, height)
  for (let i = 0; i < cells.length; i += 1) if (cells[i] === CELL_FLOOR && mask[i] === 0) cells[i] = CELL_OBSTACLE
  return size
}

// ---- Composition ----------------------------------------------------------------------------

/**
 * Builds the cell byte grid for one attempt: shape → wall CA → hole CA → connectivity repair.
 * @param {number} seed_state non-zero u32
 * @returns {{ width: number, height: number, cells: Uint8Array, region_size: number }}
 */
function build_grid(seed_state) {
  const rng = make_rng(seed_state)
  const span = FIGHT_GRID_CELLS_MAX - FIGHT_GRID_CELLS_MIN + 1
  const width = FIGHT_GRID_CELLS_MIN + rng.below(span)
  const height = FIGHT_GRID_CELLS_MIN + rng.below(span)

  const walls = seed_bit_grid(rng, width, height, FILL_PERCENT)
  ca_smooth(walls, width, height)

  const holes = seed_bit_grid(rng, width, height, HOLE_FILL_PERCENT)
  ca_smooth(holes, width, height)

  const cells = new Uint8Array(width * height)
  for (let i = 0; i < cells.length; i += 1) {
    if (walls[i] === 1) cells[i] = CELL_OBSTACLE
    else if (holes[i] === 1) cells[i] = CELL_HOLE
    else cells[i] = CELL_FLOOR
  }

  const region_size = repair_connectivity(cells, width, height)
  return { width, height, cells, region_size }
}

/**
 * Enumerates walkable cells (CELL_FLOOR) in row-major scan order.
 * @param {Uint8Array} cells
 * @param {number} width
 * @returns {{ x: number, y: number }[]}
 */
function walkable_cells(cells, width) {
  /** @type {{ x: number, y: number }[]} */
  const list = []
  for (let i = 0; i < cells.length; i += 1) {
    if (cells[i] === CELL_FLOOR) {
      const x = i % width
      list.push({ x, y: (i - x) / width })
    }
  }
  return list
}

// ---- Public API -----------------------------------------------------------------------------

/**
 * @typedef {Object} FightGrid
 * @property {number} width          grid width in cells (10..18)
 * @property {number} height         grid height in cells (10..18)
 * @property {Uint8Array} cells      row-major cell bytes: 0=floor, 1=obstacle, 2=hole
 * @property {{ x: number, y: number }[]} player_starts  player seats, all walkable, non-overlapping
 * @property {{ x: number, y: number }[]} mob_starts     mob spawns, all walkable, non-overlapping
 */

/**
 * Deterministically derives a fight arena from (dungeon_hash, room_index). Same inputs ⇒
 * identical result on every machine and bit-for-bit identical to the Move on-chain twin (§6.6).
 *
 * @param {bigint | number | string} dungeon_hash 64-bit dungeon hash (BigInt/int/hex or decimal string)
 * @param {number} room_index non-negative room number within the dungeon
 * @param {{ player_count: number, mob_count: number }} counts required start-position counts
 * @returns {FightGrid}
 */
export function generate_fight_grid(dungeon_hash, room_index, counts) {
  const player_count = counts.player_count | 0
  const mob_count = counts.mob_count | 0
  if (player_count < 0 || mob_count < 0) throw new Error('fight_grid: player_count/mob_count must be non-negative')
  const needed = player_count + mob_count

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const seed_state = mix_seed(dungeon_hash, room_index, attempt)
    const { width, height, cells, region_size } = build_grid(seed_state)
    if (region_size < needed) continue // arena too small for both teams — reroll deterministically

    const walkable = walkable_cells(cells, width)
    // Players seat from the front of scan order, mobs from the back — opposite ends, no overlap.
    /** @type {{ x: number, y: number }[]} */
    const player_starts = []
    /** @type {{ x: number, y: number }[]} */
    const mob_starts = []
    for (let i = 0; i < player_count; i += 1) player_starts.push(walkable[i])
    for (let i = 0; i < mob_count; i += 1) mob_starts.push(walkable[walkable.length - 1 - i])

    return { width, height, cells, player_starts, mob_starts }
  }

  throw new Error(
    `fight_grid: could not derive an arena with >= ${needed} walkable cells within ${MAX_ATTEMPTS} attempts`
  )
}

/**
 * Debug/spec helper — exposes the raw seed state for a given input triple (attempt 0). Used by
 * the golden test and by the Move-twin cross-check. Not part of the runtime render path.
 * @param {bigint | number | string} dungeon_hash
 * @param {number} room_index
 * @returns {number} the u32 xorshift seed state for attempt 0
 */
export function fight_grid_seed_state(dungeon_hash, room_index) {
  return mix_seed(dungeon_hash, room_index, 0)
}
