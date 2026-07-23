// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Seam 1 gate — the Y-oracle is pure, deterministic, matches the generated terrain, and rejects fluids.

import { test, expect, describe } from 'bun:test'

import { CHUNK_SIZE, SEA_LEVEL, WORLD_HEIGHT } from '../config/world_config.js'
import { column_index, get_block_id } from '../chunks/format.js'
import { create_gen_context, build_column_profile } from '../gen/column_gen.js'
import { generate_world_chunk } from '../gen/world_gen.js'
import { DEFAULT_WORLD_GEN_CONFIG } from '../config/world_gen_config.js'
import { WORLD_CONFIGS } from '../config/worlds/index.js'

import { ground_height } from './ground_height.js'

const default_ctx = create_gen_context(DEFAULT_WORLD_GEN_CONFIG)

// a deterministic lattice of 100 world columns spread around spawn (no RNG in tests).
const COORDS = Array.from({ length: 100 }, (_, i) => [((i * 613) % 1400) - 700, ((i * 379) % 1400) - 700])

const floor_div = (/** @type {number} */ a, /** @type {number} */ b) => Math.floor(a / b)
const local = (/** @type {number} */ a) => ((a % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE
const SOLID_FLUIDS = new Set([5, 24]) // water, lava — never "ground"

describe('binding/ground_height — determinism (§4)', () => {
  test('same (config, x, z) → identical y, twice, across 100 coords', () => {
    for (const [x, z] of COORDS) {
      expect(ground_height(DEFAULT_WORLD_GEN_CONFIG, x, z)).toBe(ground_height(DEFAULT_WORLD_GEN_CONFIG, x, z))
    }
  })

  test('nullish config falls back to the default recipe', () => {
    for (const [x, z] of COORDS.slice(0, 10)) {
      expect(ground_height(null, x, z)).toBe(ground_height(DEFAULT_WORLD_GEN_CONFIG, x, z))
    }
  })

  test('integer output; fractional coords floor to the voxel column', () => {
    for (const [x, z] of COORDS.slice(0, 10)) {
      const y = ground_height(DEFAULT_WORLD_GEN_CONFIG, x, z)
      expect(Number.isInteger(y)).toBe(true)
      expect(ground_height(DEFAULT_WORLD_GEN_CONFIG, x + 0.7, z + 0.2)).toBe(y)
    }
  })
})

describe('binding/ground_height — purity (no gen module-global mutation)', () => {
  test('querying another world recipe never perturbs the default recipe results', () => {
    const other = Object.values(WORLD_CONFIGS).find((c) => c && c.seed !== DEFAULT_WORLD_GEN_CONFIG.seed)
    expect(other).toBeTruthy()

    const baseline = COORDS.map(([x, z]) => ground_height(DEFAULT_WORLD_GEN_CONFIG, x, z))
    const other_heights = COORDS.map(([x, z]) => ground_height(other, x, z))
    // the other recipe is genuinely used (different terrain ⇒ at least one column differs)…
    expect(other_heights.some((y, i) => y !== baseline[i])).toBe(true)
    // …and the default recipe is byte-stable after (proves the per-config context is isolated).
    const after = COORDS.map(([x, z]) => ground_height(DEFAULT_WORLD_GEN_CONFIG, x, z))
    expect(after).toEqual(baseline)
  })
})

describe('binding/ground_height — matches the generated terrain (generate & compare)', () => {
  test('oracle === the generator ground_top for ≥98/100 columns (rest ≤2 blocks, 3D-density edge)', () => {
    let exact = 0
    let max_diff = 0
    for (const [x, z] of COORDS) {
      const cx = floor_div(x, CHUNK_SIZE)
      const cz = floor_div(z, CHUNK_SIZE)
      const gtop = build_column_profile(default_ctx, cx, cz).ground_top[column_index(local(x), local(z))]
      const y = ground_height(DEFAULT_WORLD_GEN_CONFIG, x, z)
      if (y === gtop) exact += 1
      max_diff = Math.max(max_diff, Math.abs(y - gtop))
    }
    expect(exact).toBeGreaterThanOrEqual(98)
    expect(max_diff).toBeLessThanOrEqual(2)
  })

  test('the analytic y lands on real generated voxels — block below is solid terrain', () => {
    // Generate the containing chunk and assert the block at (ground_height − 1) is a solid, non-fluid
    // TERRAIN block. Skips the rare beach-waterline band (the world_gen beach-flatten polish lifts those
    // dry only in the generated chunk, not in the un-flattened column math the oracle mirrors).
    let checked = 0
    for (const [x, z] of COORDS) {
      const y = ground_height(DEFAULT_WORLD_GEN_CONFIG, x, z)
      if (y >= SEA_LEVEL - 2 && y <= SEA_LEVEL + 3) continue // beach-flatten band — skip
      const cx = floor_div(x, CHUNK_SIZE)
      const cz = floor_div(z, CHUNK_SIZE)
      const top_solid_y = y - 1
      if (top_solid_y < 0 || top_solid_y >= WORLD_HEIGHT) continue
      const cy = floor_div(top_solid_y, CHUNK_SIZE)
      const chunk = generate_world_chunk(cx, cy, cz)
      const id = get_block_id(chunk, local(x), local(top_solid_y), local(z))
      expect(id).not.toBe(0) // not air — real geometry sits here
      expect(SOLID_FLUIDS.has(id)).toBe(false) // and it is not a fluid
      checked += 1
    }
    expect(checked).toBeGreaterThan(50)
    // 30s timeout (#641): up to 100 real generate_world_chunk calls — the default 5s flakes under
    // full-suite/CI-runner load while passing isolated (same class as column_gen.test.js's 15s precedent).
  }, 30000)
})

describe('binding/ground_height — fluid rejection (§4)', () => {
  test('ocean columns return the SEABED, never the sea plane', () => {
    // Find columns whose ground sits below sea level; the oracle must report the solid seabed (< sea),
    // and in the generated chunk the block at ground_height itself is water/air (the seabed is beneath).
    let ocean = 0
    for (const [x, z] of COORDS) {
      const y = ground_height(DEFAULT_WORLD_GEN_CONFIG, x, z)
      if (y >= SEA_LEVEL) continue
      ocean += 1
      expect(y).toBeLessThan(SEA_LEVEL) // NOT clamped to the water surface
      // the generator agrees this column's terrain top is the seabed (fluids excluded).
      const cx = floor_div(x, CHUNK_SIZE)
      const cz = floor_div(z, CHUNK_SIZE)
      const gtop = build_column_profile(default_ctx, cx, cz).ground_top[column_index(local(x), local(z))]
      expect(Math.abs(y - gtop)).toBeLessThanOrEqual(2)
      // the block AT the sea surface above this seabed is water in the generated chunk (proves fluid sits
      // above the returned ground, and the oracle rejected it). GUARD (GEN_VERSION 12 flat-smooth): only for
      // a CLEARLY-submerged seabed (gtop ≤ SEA_LEVEL−2) — a column the oracle rounds just under sea while the
      // chunk seabed rounds to the waterline (within the ±2 oracle/chunk tolerance above) is a SHOAL, where
      // the block at SEA_LEVEL−1 is legitimately its own solid top, not a fluid cell (boundary, not a bug).
      if (gtop <= SEA_LEVEL - 2) {
        const cy = floor_div(SEA_LEVEL - 1, CHUNK_SIZE)
        const chunk = generate_world_chunk(cx, cy, cz)
        const id = get_block_id(chunk, local(x), local(SEA_LEVEL - 1), local(z))
        expect(id === 5 || id === 0).toBe(true) // water (or air where a wave-carved cell) — not solid ground
      }
    }
    expect(ocean).toBeGreaterThan(0)
  })
})
