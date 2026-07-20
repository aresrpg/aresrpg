// world_gen.js gate — the decorated world-chunk path the island loader consumes. Covers the four
// invariants from the WS2 first-cut brief. NOTE: the golden world-identity hash for the terrain
// CORE lives in column_gen.test.js (generate_column, decoration-free); this file guards the
// DECORATED path's self-consistency plus terrain sanity, and the transcendental ban for the two
// files this workstream added (surface_decorator.js + world_gen.js).

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { test, expect, describe } from 'bun:test'

import { CHUNK_SIZE, SEA_LEVEL } from '../config/world_config.js'
import { local_index, column_index } from '../chunks/format.js'
import { get_block_by_name } from '../config/block_registry.js'

import { generate_world_chunk, world_surface_y } from './world_gen.js'
import { create_gen_context, build_column_profile } from './column_gen.js'

const WATER = /** @type {number} */ (get_block_by_name('water')?.id)

/** Fixed chunks hashed for the determinism check — a decorated land chunk, a crown chunk, ocean. */
const FIXED_CHUNKS = [
  [0, 4, 0],
  [1, 5, 1],
  [-12, 3, 6],
]

/**
 * sha256 over the ids bytes of the fixed chunk set (fresh generation each call).
 * @returns {string} hex digest
 */
function hash_fixed_chunks() {
  const hash = createHash('sha256')
  for (const [cx, cy, cz] of FIXED_CHUNKS) {
    const chunk = generate_world_chunk(cx, cy, cz)
    hash.update(new Uint8Array(chunk.ids.buffer))
  }
  return hash.digest('hex')
}

describe('world_gen determinism (§3.7)', () => {
  test('regenerating the fixed chunk set yields byte-identical ids', () => {
    expect(hash_fixed_chunks()).toBe(hash_fixed_chunks())
  })
})

describe('world_gen terrain sanity', () => {
  test('adjacent columns differ by <= 20 blocks (no single-column spikes)', () => {
    let max_delta = 0
    let pairs = 0
    // 1024 deterministic sample columns spread over a wide lattice; compare each to its +x neighbor.
    for (let gx = 0; gx < 32; gx += 1) {
      for (let gz = 0; gz < 32; gz += 1) {
        const x = gx * 31 - 480
        const z = gz * 29 - 460
        const delta = Math.abs(world_surface_y(x, z) - world_surface_y(x + 1, z))
        if (delta > max_delta) max_delta = delta
        pairs += 1
      }
    }
    expect(pairs).toBeGreaterThanOrEqual(1000)
    expect(max_delta).toBeLessThanOrEqual(20)
  })

  test('sea-level invariant: sub-sea-level columns are water-filled up to y=127', () => {
    // (-12, 6) is an ocean chunk footprint for the hardcoded seed; cy=3 spans world y 96..127.
    // Reference surface = the column PROFILE the fill actually consumes (since the relief-ladder fork
    // the SMOOTH world_surface_y probe no longer tracks the effective land surface — the ladder rides
    // every column). Columns in the waterline band (≥ SEA_LEVEL-2) are skipped: the beach-flatten
    // polish may lift those dry. Everything deeper must be water up to the sea surface.
    const cx = -12
    const cz = 6
    const cy = 3
    const base_world_y = cy * CHUNK_SIZE // 96
    const chunk = generate_world_chunk(cx, cy, cz)
    const profile = build_column_profile(create_gen_context(), cx, cz)

    let ocean_columns = 0
    for (let z = 0; z < CHUNK_SIZE; z += 1) {
      for (let x = 0; x < CHUNK_SIZE; x += 1) {
        const surface = profile.surface_y[column_index(x, z)]
        if (surface >= SEA_LEVEL - 2) continue // waterline band — beach flatten may lift it dry
        ocean_columns += 1
        const from = Math.max(surface, base_world_y)
        for (let wy = from; wy < SEA_LEVEL && wy < base_world_y + CHUNK_SIZE; wy += 1) {
          expect(chunk.ids[local_index(x, wy - base_world_y, z)]).toBe(WATER)
        }
      }
    }
    expect(ocean_columns).toBeGreaterThan(0)
  })
})

describe('world_gen transcendental ban (§3.7) — files added by this workstream', () => {
  const BANNED = /Math\.(sin|cos|tan|asin|acos|atan|atan2|pow|exp|expm1|log|log2|log10|cbrt|hypot|random)\b/

  for (const file of ['world_gen.js', 'surface_decorator.js']) {
    test(`${file} is transcendental-free`, () => {
      const path = fileURLToPath(new URL(file, import.meta.url))
      const src = readFileSync(path, 'utf8')
      // Strip block + line comments so the ban-list named in doc comments doesn't self-trip.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
      expect(BANNED.test(code)).toBe(false)
    })
  }
})
