// M0 test data generator (§8 M0 "flat-ish test gen") — a deterministic low dome/plateau island:
// grass-over-dirt-over-stone, water filling anything below sea level. This is a placeholder for
// WS2's real terrain generator; it exists purely so WS3/WS4 have real surfaces to mesh/render.
//
// DETERMINISM LAW (§3.7): integer arithmetic ONLY — no Math.sin/cos/pow/exp/random. The "noise"
// here is an integer hash (splitmix-style, same lineage as world_config.js's splitmix64) turned
// into a small bounded height offset via modulo — cheap, deterministic, and good enough to give
// the mesher varied surfaces (bumps, a plateau edge) without any transcendental math.

import { CHUNK_SIZE } from '../config/world_config.js'
import { get_block_by_name } from '../config/block_registry.js'

import { column_index, create_chunk_record, local_index, meta_cell_index, set_occupancy_bit } from './format.js'
import { fill_simple_light } from './light_engine.js'

const STONE = /** @type {number} */ (get_block_by_name('stone')?.id)
const DIRT = /** @type {number} */ (get_block_by_name('dirt')?.id)
const GRASS = /** @type {number} */ (get_block_by_name('grass')?.id)
const SAND = /** @type {number} */ (get_block_by_name('sand')?.id)
const WATER = /** @type {number} */ (get_block_by_name('water')?.id)
const AIR = /** @type {number} */ (get_block_by_name('air')?.id)

/** Island dome parameters — hand-picked constants, all integers. */
const ISLAND_CENTER_X = 16
const ISLAND_CENTER_Z = 16
const ISLAND_RADIUS = 20
const DOME_HEIGHT = 14
const BASE_TERRAIN_Y = 6
const SEA_LEVEL_LOCAL = 8
const DIRT_LAYERS = 3

const U32_MASK = 0xffffffff

/**
 * Deterministic integer hash → bounded value in [0, mod). Pure multiply/xor/shift on 32-bit
 * unsigned integers (no BigInt needed at this small scale, no transcendentals).
 * @param {number} x
 * @param {number} z
 * @param {number} mod
 * @returns {number}
 */
function hash_bump(x, z, mod) {
  let h = (x * 374761393 + z * 668265263) & U32_MASK
  h = (h ^ (h >>> 13)) & U32_MASK
  h = (h * 1274126177) & U32_MASK
  h = (h ^ (h >>> 16)) & U32_MASK
  return h % mod
}

/** Spatial cell size (blocks) over which the surface bump is held constant, then bilinearly
 * blended between cells — makes the noise LOW-FREQUENCY so adjacent columns differ by at most 1,
 * not by a random ±2. High-frequency per-column noise turns every step edge into a T-junction
 * seam that leaks the sky-background color on stepped tops (coordinator's speck report); a
 * coherent bump keeps the dome gently stepped and watertight-looking. */
const BUMP_CELL = 8
/** Bump amplitude in blocks (0..BUMP_AMP after blending). Small on purpose — real gen is WS2. */
const BUMP_AMP = 3

/**
 * Coherent integer surface bump at a column, bilinearly interpolated from per-`BUMP_CELL`-cell
 * hash corners so neighboring columns share nearly-identical bumps (≤1 block apart). Integer-only
 * (fixed-point blend), no transcendentals — satisfies the determinism law.
 * @param {number} world_x
 * @param {number} world_z
 * @returns {number} 0..BUMP_AMP
 */
function coherent_bump(world_x, world_z) {
  const cx = Math.floor(world_x / BUMP_CELL)
  const cz = Math.floor(world_z / BUMP_CELL)
  const fx = world_x - cx * BUMP_CELL // 0..BUMP_CELL-1
  const fz = world_z - cz * BUMP_CELL

  // Four cell-corner amplitudes in a fixed-point range [0, BUMP_AMP*256] for integer blending.
  const scale = (BUMP_AMP + 1) * 256
  const c00 = hash_bump(cx, cz, scale)
  const c10 = hash_bump(cx + 1, cz, scale)
  const c01 = hash_bump(cx, cz + 1, scale)
  const c11 = hash_bump(cx + 1, cz + 1, scale)

  // Bilinear blend, all integer math (weights out of BUMP_CELL).
  const top = c00 * (BUMP_CELL - fx) + c10 * fx
  const bot = c01 * (BUMP_CELL - fx) + c11 * fx
  const blended = (top * (BUMP_CELL - fz) + bot * fz) / (BUMP_CELL * BUMP_CELL)
  return Math.min(BUMP_AMP, (blended / 256) | 0)
}

/**
 * Integer-only column height for the test island: a dome falling off from the center radius,
 * clamped to 0 outside the island, plus a coherent low-frequency bump for gentle surface
 * variation (adjacent columns differ by ≤1 block — no jagged single-column spikes).
 * @param {number} world_x
 * @param {number} world_z
 * @returns {number} height above BASE_TERRAIN_Y, >= 0
 */
function dome_height(world_x, world_z) {
  const dx = world_x - ISLAND_CENTER_X
  const dz = world_z - ISLAND_CENTER_Z
  const dist_sq = dx * dx + dz * dz
  const radius_sq = ISLAND_RADIUS * ISLAND_RADIUS
  if (dist_sq >= radius_sq) return 0

  // Integer "falloff": linear ramp down from DOME_HEIGHT at center to 0 at the radius edge,
  // using integer division (Math.floor equivalent via | 0) — no sqrt/trig.
  const falloff = ((radius_sq - dist_sq) * DOME_HEIGHT) / radius_sq
  const base = falloff | 0
  return Math.max(0, base + coherent_bump(world_x, world_z))
}

/**
 * Generates one deterministic test chunk: a flat-ish heightmap island (grass/dirt/stone) with
 * water filling below sea level. Pure function of (cx, cy, cz) — same inputs always produce the
 * same chunk (§3.7).
 * @param {number} cx
 * @param {number} cy
 * @param {number} cz
 * @returns {import('./format.js').ChunkRecord}
 */
export function generate_test_chunk(cx, cy, cz) {
  const chunk = create_chunk_record(cx, cy, cz)
  const base_world_y = cy * CHUNK_SIZE

  for (let z = 0; z < CHUNK_SIZE; z += 1) {
    const world_z = cz * CHUNK_SIZE + z

    for (let x = 0; x < CHUNK_SIZE; x += 1) {
      const world_x = cx * CHUNK_SIZE + x
      const surface_world_y = BASE_TERRAIN_Y + dome_height(world_x, world_z)
      // `height` = first non-opaque (air) world-y above the surface — the fill loop below writes
      // solids for `world_y < surface_world_y`, so the first air cell is exactly surface_world_y
      // (or the sea surface for underwater columns). light_engine.fill_simple_light uses this as
      // the sun boundary (`world_y >= height` ⇒ lit), so it must be the first-air y, not +1.
      const first_air_world_y = Math.max(surface_world_y, SEA_LEVEL_LOCAL)

      chunk.height[column_index(x, z)] = first_air_world_y

      for (let cell_y = 0; cell_y < 8; cell_y += 1) {
        chunk.biome[meta_cell_index(x >> 2, cell_y, z >> 2)] = 0
      }

      for (let y = 0; y < CHUNK_SIZE; y += 1) {
        const world_y = base_world_y + y
        let block_id = AIR

        if (world_y < surface_world_y) {
          const depth_from_surface = surface_world_y - world_y
          if (depth_from_surface <= 1 && surface_world_y > SEA_LEVEL_LOCAL) block_id = GRASS
          else if (depth_from_surface <= 1) block_id = SAND
          else if (depth_from_surface <= DIRT_LAYERS) block_id = DIRT
          else block_id = STONE
        } else if (world_y < SEA_LEVEL_LOCAL) {
          block_id = WATER
        }

        chunk.ids[local_index(x, y, z)] = block_id

        if (block_id !== AIR && get_block_by_name_class_solid(block_id)) {
          set_occupancy_bit(chunk, 0, y * CHUNK_SIZE + z, x, true)
          set_occupancy_bit(chunk, 1, x * CHUNK_SIZE + z, y, true)
          set_occupancy_bit(chunk, 2, x * CHUNK_SIZE + y, z, true)
        }
      }
    }
  }

  fill_simple_light(chunk)

  chunk.stage = 'lit'
  chunk.dirty = true

  return chunk
}

/**
 * Solid-class check by id, using the already-imported registry constants (avoids re-importing
 * get_block_by_id just for a class check on 5 known ids in this test generator).
 * @param {number} block_id
 * @returns {boolean}
 */
function get_block_by_name_class_solid(block_id) {
  return block_id === STONE || block_id === DIRT || block_id === GRASS || block_id === SAND
}
