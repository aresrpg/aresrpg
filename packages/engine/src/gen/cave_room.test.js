// D141 — CAVE ROOM GENERATOR tests. Four gates:
//   1. CONFIG        — defaults resolve; invalid recipes fail loud (board contract + degenerate room).
//   2. DETERMINISM   — same (config,seed) ⇒ byte-identical block set (hashed); different seed differs.
//                      + a transcendental ban on the gen source (integer-hash discipline / §3.7).
//   3. BOARD REGION  — the designated flat region is dead-flat: solid floor under it, clear air above,
//                      no décor on it; board_anchor + a MAX (17×19) board fit inside the interior.
//   4. ENCLOSURE     — the room is genuinely sealed (solid ceiling/walls) except the ceiling holes,
//                      so the light BFS floods dark + the froxel enclosure gate + shafts engage.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { test, expect, describe } from 'bun:test'
import { test as d213_test, expect as d213_expect } from 'bun:test'
import { test as d232_test, expect as d232_expect } from 'bun:test'

import { get_block_by_name } from '../config/block_registry.js'
import { CHUNK_SIZE } from '../config/world_config.js'
import { get_sun_light, local_index } from '../chunks/format.js'

const CAVE_STONE = /** @type {number} */ (get_block_by_name('cave_stone')?.id)
const MOSSY_STONE = /** @type {number} */ (get_block_by_name('mossy_stone')?.id)
const FLOOR_IDS = new Set([CAVE_STONE, MOSSY_STONE])

/** Board's max footprint in cells (must mirror cave_room.js) → the flat region must contain it. */
const BOARD_MAX_CELLS_X = 17
const BOARD_MAX_CELLS_Z = 19
const BOARD_CELL_M = 2

/** Order-independent hash of a room's block-id set (chunk coords + every non-air voxel + its index).
 *  Two rooms with the identical geometry hash equal; any drift moves it. Uses BigInt (exact). */
function hash_room_blocks(/** @type {import('./cave_room.js').CaveRoom} */ room) {
  let h = 1469598103934665603n
  const keys = [...room.chunks.keys()].sort()
  for (const key of keys) {
    const rec = /** @type {any} */ (room.chunks.get(key))
    // fold the chunk coord
    for (const v of [rec.cx, rec.cy, rec.cz]) h = ((h ^ BigInt(v & 0xffff)) * 1099511628211n) & ((1n << 96n) - 1n)
    const { ids } = rec
    for (let i = 0; i < ids.length; i += 1) {
      if (ids[i] === 0) continue
      h = ((h ^ BigInt(i)) * 1099511628211n) & ((1n << 96n) - 1n)
      h = ((h ^ BigInt(ids[i])) * 1099511628211n) & ((1n << 96n) - 1n)
    }
  }
  return h
}

// ---- 1. CONFIG --------------------------------------------------------------------------------
describe('config: defaults resolve + invalid recipes fail loud', () => {
  test('defaults resolve to a full frozen config', () => {
    const c = resolve_cave_config()
    expect(c.size_x).toBe(DEFAULT_CAVE_CONFIG.size_x)
    expect(Object.isFrozen(c)).toBe(true)
    // the default room must be able to seat the flat board region with wall room to spare
    expect(c.size_x).toBeGreaterThanOrEqual(FLAT_REGION_X + 2 * c.wall_thickness)
    expect(c.size_z).toBeGreaterThanOrEqual(FLAT_REGION_Z + 2 * c.wall_thickness)
  })

  test('a partial override merges over the defaults', () => {
    const c = resolve_cave_config({ hole_count: 7, lava_enabled: false })
    expect(c.hole_count).toBe(7)
    expect(c.lava_enabled).toBe(false)
    expect(c.size_x).toBe(DEFAULT_CAVE_CONFIG.size_x) // untouched
  })

  test('too-small room (board region cannot fit) throws', () => {
    expect(() => resolve_cave_config({ size_x: 20 })).toThrow(/size_x/)
    expect(() => resolve_cave_config({ size_z: 20 })).toThrow(/size_z/)
  })

  test('ceiling_max < ceiling_min throws', () => {
    expect(() => resolve_cave_config({ ceiling_min: 20, ceiling_max: 10 })).toThrow(/ceiling_max/)
  })

  test('ceiling too low / floor too low throw', () => {
    expect(() => resolve_cave_config({ ceiling_min: 4 })).toThrow(/ceiling_min/)
    expect(() => resolve_cave_config({ floor_y: 1 })).toThrow(/floor_y/)
  })

  test('out-of-range mushroom palette index throws', () => {
    expect(() => resolve_cave_config({ mushroom_palette: [0, 9] })).toThrow(/palette/)
  })

  test('non-finite numeric field throws', () => {
    expect(() => resolve_cave_config({ hole_count: Number.NaN })).toThrow(/hole_count/)
  })
})

// ---- 2. DETERMINISM ---------------------------------------------------------------------------
describe('determinism: (config, seed) fully determines the block set', () => {
  test('same seed ⇒ byte-identical block set', () => {
    const a = hash_room_blocks(generate_cave_room({ seed: 42 }))
    const b = hash_room_blocks(generate_cave_room({ seed: 42 }))
    expect(a).toBe(b)
  })

  test('different seed ⇒ different block set', () => {
    const a = hash_room_blocks(generate_cave_room({ seed: 42 }))
    const c = hash_room_blocks(generate_cave_room({ seed: 43 }))
    expect(a).not.toBe(c)
  })

  test('seed arg and config.seed are equivalent', () => {
    const via_arg = hash_room_blocks(generate_cave_room({ seed: 7 }))
    const via_cfg = hash_room_blocks(generate_cave_room({ config: { seed: 7 } }))
    expect(via_arg).toBe(via_cfg)
  })

  test('a config knob changes the room (recipe is live, not ignored)', () => {
    const base = hash_room_blocks(generate_cave_room({ seed: 5 }))
    const more_holes = hash_room_blocks(generate_cave_room({ seed: 5, config: { hole_count: 8 } }))
    const no_lava = hash_room_blocks(generate_cave_room({ seed: 5, config: { lava_enabled: false } }))
    expect(more_holes).not.toBe(base)
    expect(no_lava).not.toBe(base)
  })

  test('gen source is integer-only (no transcendentals — determinism law §3.7)', () => {
    const src = readFileSync(fileURLToPath(new URL('./cave_room.js', import.meta.url)), 'utf8')
    // strip line comments + block comments so doc prose ("sin/cos allowed in render") never trips it.
    const code = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const bad of ['Math.sin', 'Math.cos', 'Math.tan', 'Math.pow', 'Math.exp', 'Math.log', 'Math.random']) {
      expect(code.includes(bad)).toBe(false)
    }
  })
})

// ---- 3. BOARD REGION --------------------------------------------------------------------------
describe('board region: the designated flat floor is dead-flat + clear', () => {
  const room = generate_cave_room({ seed: 99 })
  const { config, board_anchor, bounds } = room
  const { floor_y } = config

  // the flat region rectangle (world) — centred on the interior, mirroring cave_room.flat_region.
  const fmin_x = Math.round((config.size_x - FLAT_REGION_X) / 2)
  const fmin_z = Math.round((config.size_z - FLAT_REGION_Z) / 2)
  const fmax_x = fmin_x + FLAT_REGION_X
  const fmax_z = fmin_z + FLAT_REGION_Z

  test('solid floor under the whole flat region (walkable ground at floor_y-1)', () => {
    let solid = 0
    let total = 0
    for (let wx = fmin_x; wx < fmax_x; wx += 1)
      for (let wz = fmin_z; wz < fmax_z; wz += 1) {
        total += 1
        if (FLOOR_IDS.has(room.sample_block(wx, floor_y - 1, wz))) solid += 1
      }
    expect(solid).toBe(total) // every column of the flat region has ground beneath it
  })

  test('clear air above the flat region (no obstacle/décor on the board floor, ≥3 blocks headroom)', () => {
    for (let wx = fmin_x; wx < fmax_x; wx += 1)
      for (let wz = fmin_z; wz < fmax_z; wz += 1)
        for (let dy = 0; dy < 3; dy += 1) expect(room.sample_block(wx, floor_y + dy, wz)).toBe(0) // AIR — dead flat, nothing planted
  })

  test('board_anchor y = floor top; a MAX 17×19 board fits inside the interior', () => {
    const [ax, ay, az] = board_anchor
    expect(ay).toBe(floor_y)
    // the board spans [ax, ax + 17·2) × [az, az + 19·2) — must lie within the interior [0,size)²
    expect(ax).toBeGreaterThanOrEqual(0)
    expect(az).toBeGreaterThanOrEqual(0)
    expect(ax + BOARD_MAX_CELLS_X * BOARD_CELL_M).toBeLessThanOrEqual(config.size_x)
    expect(az + BOARD_MAX_CELLS_Z * BOARD_CELL_M).toBeLessThanOrEqual(config.size_z)
  })

  test('board_anchor centres the max board inside the flat region', () => {
    const [ax, , az] = board_anchor
    const board_w = BOARD_MAX_CELLS_X * BOARD_CELL_M
    const board_h = BOARD_MAX_CELLS_Z * BOARD_CELL_M
    // symmetric margins on each side (±1 for integer rounding)
    expect(Math.abs(ax - fmin_x - (fmax_x - (ax + board_w)))).toBeLessThanOrEqual(1)
    expect(Math.abs(az - fmin_z - (fmax_z - (az + board_h)))).toBeLessThanOrEqual(1)
  })

  test('bounds enclose the interior walkable box', () => {
    expect(bounds.floor_y).toBe(floor_y)
    expect(bounds.min_x).toBeGreaterThan(0)
    expect(bounds.max_x).toBeLessThan(config.size_x)
    expect(bounds.ceiling_y).toBeGreaterThan(floor_y + config.ceiling_min)
  })

  test('flatness holds across seeds (the region is clear for every recipe)', () => {
    for (const seed of [1, 2, 3, 100, 7777]) {
      const r = generate_cave_room({ seed })
      const fx = Math.round((r.config.size_x - FLAT_REGION_X) / 2)
      const fz = Math.round((r.config.size_z - FLAT_REGION_Z) / 2)
      let clear = true
      for (let wx = fx; wx < fx + FLAT_REGION_X && clear; wx += 1)
        for (let wz = fz; wz < fz + FLAT_REGION_Z && clear; wz += 1) {
          if (r.sample_block(wx, r.config.floor_y, wz) !== 0) clear = false
          if (!FLOOR_IDS.has(r.sample_block(wx, r.config.floor_y - 1, wz))) clear = false
        }
      expect(clear).toBe(true)
    }
  })
})

// ---- 4. ENCLOSURE -----------------------------------------------------------------------------
describe('enclosure: the room is sealed except the ceiling holes', () => {
  const room = generate_cave_room({ seed: 3 })
  const { config } = room
  const { floor_y } = config

  test('the floor is solid across the whole interior (no fall-through)', () => {
    // sample a coarse grid to keep it fast; the floor slab must be solid everywhere except the lava bed.
    let holes = 0
    for (let wx = 1; wx < config.size_x - 1; wx += 3)
      for (let wz = 1; wz < config.size_z - 1; wz += 3) if (room.sample_block(wx, floor_y - 2, wz) === 0) holes += 1
    // some air is allowed under the lava ravine bed; but the vast majority of columns are solid.
    const sampled = Math.ceil((config.size_x - 2) / 3) * Math.ceil((config.size_z - 2) / 3)
    expect(holes).toBeLessThan(sampled * 0.15)
  })

  test('the ceiling is mostly solid (sealed roof) but the holes punch through to open air', () => {
    const ceil_scan_y = floor_y + config.ceiling_max + 1 // at/above the highest ceiling → shell rock
    let solid = 0
    let open = 0
    for (let wx = 2; wx < config.size_x - 2; wx += 1)
      for (let wz = 2; wz < config.size_z - 2; wz += 1) {
        // find the column's roof: scan down from the top for the first solid above the floor+min.
        let roof_solid = false
        for (let wy = ceil_scan_y; wy > floor_y + config.ceiling_min; wy -= 1) {
          if (room.sample_block(wx, wy, wz) !== 0) {
            roof_solid = true
            break
          }
        }
        if (roof_solid) solid += 1
        else open += 1 // this column is open to the sky = a ceiling hole
      }
    expect(solid).toBeGreaterThan(0)
    expect(open).toBeGreaterThan(0) // at least one shaft exists (hole_count default 4)
    // sealed: the open (hole) columns are a small minority of the roof, not a leaky ceiling.
    expect(open).toBeLessThan(solid)
  })

  test('the walls are solid rock (interior is enclosed on the sides)', () => {
    const mid_y = floor_y + 2
    // just outside the interior on each side must be solid shell.
    expect(room.sample_block(-1, mid_y, config.size_z / 2)).not.toBe(0)
    expect(room.sample_block(config.size_x, mid_y, config.size_z / 2)).not.toBe(0)
    expect(room.sample_block(config.size_x / 2, mid_y, -1)).not.toBe(0)
    expect(room.sample_block(config.size_x / 2, mid_y, config.size_z)).not.toBe(0)
  })
})

// ---- 5. ENG-17: BFS DARKNESS + SHAFTS + WALK SPAWN ------------------------------------------------
// The enclosure test above proves the room is geometrically sealed. These prove the CONSEQUENCE the
// atmosphere depends on: the skylight BFS (fill_simple_light, run in generate_cave_room) floods the
// sealed interior DARK (sun light 0 at eye level away from holes), while a ceiling hole admits a
// vertical SHAFT of sun down to the floor. Plus the walk-mode contract: player_spawn is a solid,
// clear floor stand inside bounds, and bounds is a valid soft-clamp box. All gen-level + deterministic.
describe('ENG-17: enclosure floods dark (BFS) + ceiling holes admit shafts', () => {
  const room = generate_cave_room({ seed: 7 })
  const { config, board_anchor, bounds, player_spawn } = room
  const { floor_y } = config

  /** Sun-light nibble (0..15) at a WORLD voxel, read from the room's LIT records (0 outside the room). */
  function sun_at(/** @type {number} */ wx, /** @type {number} */ wy, /** @type {number} */ wz) {
    const rec = room.chunks.get(
      `${Math.floor(wx / CHUNK_SIZE)},${Math.floor(wy / CHUNK_SIZE)},${Math.floor(wz / CHUNK_SIZE)}`
    )
    if (!rec) return 0
    const lx = Math.floor(wx) - rec.cx * CHUNK_SIZE
    const ly = Math.floor(wy) - rec.cy * CHUNK_SIZE
    const lz = Math.floor(wz) - rec.cz * CHUNK_SIZE
    if (lx < 0 || ly < 0 || lz < 0 || lx >= CHUNK_SIZE || ly >= CHUNK_SIZE || lz >= CHUNK_SIZE) return 0
    return get_sun_light(rec.light[local_index(lx, ly, lz)])
  }

  test('sealed roof floods the interior DARK — a large fraction of eye-level air is sun=0', () => {
    // The load-bearing enclosure consequence: because the room is carved from solid rock (shell-first,
    // §PASS 1), most interior columns sit under solid roof, so the skylight BFS never reaches them → sun
    // light 0. (Light DOES bleed laterally from the hole shafts, so the room is not uniformly black — that
    // is the intended cathedral gradient — but a genuinely sealed room is DARK in the large. A leaky
    // ceiling would light most cells and wash the black-cave mood + the emissive-glow contrast.)
    let dark = 0
    let total = 0
    for (let wx = 2; wx < config.size_x - 2; wx += 1)
      for (let wz = 2; wz < config.size_z - 2; wz += 1) {
        const s = sun_at(wx, floor_y + 2, wz)
        if (s < 0) continue
        total += 1
        if (s === 0) dark += 1
      }
    expect(total).toBeGreaterThan(0)
    expect(dark / total).toBeGreaterThan(0.3) // ≥30% dead-dark: the sealed enclosure, not an open pit
  })

  test('ceiling holes admit full-brightness sun SHAFTS down to the floor', () => {
    // Hole columns are open to the sky, so the BFS seeds full sun (15) straight down the shaft to the
    // floor; sealed columns stay 0. At least one floor cell must be reached at full daylight = a genuine
    // cathedral shaft (what the froxel god-ray pass renders as a beam). Contrast with the darkness above.
    let full_shaft_floor_cells = 0
    for (let wx = 2; wx < config.size_x - 2; wx += 1)
      for (let wz = 2; wz < config.size_z - 2; wz += 1)
        if (sun_at(wx, floor_y + 1, wz) >= 15) full_shaft_floor_cells += 1
    expect(full_shaft_floor_cells).toBeGreaterThan(0) // daylight punches all the way to the cave floor
  })

  test('player_spawn is a solid, clear floor stand inside the interior', () => {
    const [sx, sy, sz] = player_spawn
    expect(sy).toBe(floor_y) // feet on the floor top face
    // ground beneath the feet is solid cave floor
    expect(FLOOR_IDS.has(room.sample_block(sx, floor_y - 1, sz))).toBe(true)
    // clear headroom (no décor planted on the spawn) — a stand, not an embed
    for (let dy = 0; dy < 3; dy += 1) expect(room.sample_block(sx, floor_y + dy, sz)).toBe(0)
    // inside the interior box
    expect(sx).toBeGreaterThan(0)
    expect(sx).toBeLessThan(config.size_x)
    expect(sz).toBeGreaterThan(0)
    expect(sz).toBeLessThan(config.size_z)
  })

  test('bounds is a valid interior soft-clamp box (min<max, inside the room shell)', () => {
    expect(bounds.min_x).toBeGreaterThan(0)
    expect(bounds.min_z).toBeGreaterThan(0)
    expect(bounds.max_x).toBeLessThan(config.size_x)
    expect(bounds.max_z).toBeLessThan(config.size_z)
    expect(bounds.max_x).toBeGreaterThan(bounds.min_x)
    expect(bounds.max_z).toBeGreaterThan(bounds.min_z)
    // clamping a far-outside probe back into the box lands on solid-floored, in-shell ground
    const clamp = (/** @type {number} */ v, /** @type {number} */ lo, /** @type {number} */ hi) =>
      Math.min(hi, Math.max(lo, v))
    const cx2 = clamp(999, bounds.min_x, bounds.max_x)
    const cz2 = clamp(-999, bounds.min_z, bounds.max_z)
    expect(FLOOR_IDS.has(room.sample_block(Math.floor(cx2), floor_y - 1, Math.floor(cz2)))).toBe(true)
  })
})

// ---- [D213] FLOOR SEAL INVARIANT (a player fell through a ravine pit) ----------------------------
// Below the walkable layer there is NO air anywhere in the interior; air at floor_y-1 is legal ONLY
// directly above LAVA (the glowing channel's 1-block lip). Guards every current and future carve pass.
// (import for generate_cave_room as d213_gen lives with the other ./cave_room.js imports below —
// hoisted, so usage here ahead of it is standard ESM and keeps this a single import/order group.)

d213_test('floor seal: no air below the walkable layer; channel lip only above lava (D213)', () => {
  for (const seed of [1, 3, 42, 7777]) {
    const r = d213_gen({ seed })
    const c = r.config
    const lava_id = 24 // registry 'lava' — assert against a literal so a registry shuffle fails loudly
    let violations = 0
    for (let wx = 0; wx < c.size_x; wx += 1) {
      for (let wz = 0; wz < c.size_z; wz += 1) {
        // strictly below the walkable layer: must be solid (never air) — scan within the floor
        // slab (wall_thickness deep; below that is outside the record set and reads 0 by design).
        for (let wy = c.floor_y - 2; wy > c.floor_y - 1 - c.wall_thickness; wy -= 1) {
          if (r.sample_block(wx, wy, wz) === 0) violations += 1
        }
        // the walkable layer itself: air only above lava
        if (r.sample_block(wx, c.floor_y - 1, wz) === 0 && r.sample_block(wx, c.floor_y - 2, wz) !== lava_id) {
          violations += 1
        }
      }
    }
    d213_expect(violations).toBe(0)
  }
})

// [D232] the virtual bedrock belt: below the floor slab the PURE sampler is solid forever inside the
// footprint (collision safety net — never rendered), air outside it.

import {
  generate_cave_room,
  generate_cave_room as d213_gen,
  resolve_cave_config,
  DEFAULT_CAVE_CONFIG,
  FLAT_REGION_X,
  FLAT_REGION_Z,
} from './cave_room.js'
import { generate_cave_room as d232_gen } from './cave_room.js'

d232_test('virtual bedrock: solid below the slab inside the footprint, air outside (D232)', () => {
  const r = d232_gen({ seed: 5 })
  const c = r.config
  const below = c.floor_y - c.wall_thickness - 5
  d232_expect(r.sample_block(10, below, 10)).not.toBe(0) // inside → bedrock
  d232_expect(r.sample_block(10, 1, 10)).not.toBe(0) // arbitrarily deep → still bedrock
  d232_expect(r.sample_block(-5, below, 10)).toBe(0) // outside the footprint → air (no phantom world)
})
