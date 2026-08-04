// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Seam 1 gate — the Y-oracle is pure, deterministic, matches the generated terrain, and rejects fluids.

import { test, expect, describe } from 'bun:test'

import { CHUNK_SIZE, REGION_SIZE_CHUNKS, SEA_LEVEL, WORLD_HEIGHT } from '../../src/config/world_config.js'
import { column_index, get_block_id } from '../../src/chunks/format.js'
import { create_gen_context, build_column_profile } from '../../src/gen/column_gen.js'
import { generate_world_chunk } from '../../src/gen/world_gen.js'
import { DEFAULT_WORLD_GEN_CONFIG } from '../../src/config/world_gen_config.js'
import { WORLD_CONFIGS } from '../../src/config/worlds/index.js'
import { ground_height } from '../../src/binding/ground_height.js'

const default_ctx = create_gen_context(DEFAULT_WORLD_GEN_CONFIG)

// a deterministic lattice of 100 world columns spread around spawn (no RNG in tests).
const COORDS = Array.from({ length: 100 }, (_, i) => [((i * 613) % 1400) - 700, ((i * 379) % 1400) - 700])

const floor_div = (/** @type {number} */ a, /** @type {number} */ b) => Math.floor(a / b)
const local = (/** @type {number} */ a) => ((a % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE
const SOLID_FLUIDS = new Set([5, 24]) // water, lava — never "ground"

// ── ONE tile-major generation pass, shared by every generate-and-compare test below ────────────
// The lattice above spans 36 lake tiles while hydrology memoizes 16 (LAKE_TILE_CAP), so walking it
// in lattice order re-floods the same 256-block tiles ~3× over and dominated this file's runtime
// (measured: 4.9 s of generation for 100 columns). Two mechanical cuts, no assert touched and the
// same 100 columns compared:
//   1. TILE-MAJOR ORDER — each lake tile is primed once instead of once per revisit. Priming order
//      is value-neutral by construction (column_gen.prime_column_footprint's contract, proven by
//      column_gen.test.js's eviction-neutrality golden), so the compared values are byte-identical
//      to the lattice-order sweep.
//   2. GENERATED ONCE — the three tests below used to regenerate the same terrain three times over.
// Both voxel probes ride the same pass: world_gen's column-profile memo is keyed on (cx,cz), so the
// two cy reads of one site reuse one profile.
const tile_of = (/** @type {number} */ world_c) => floor_div(floor_div(world_c, CHUNK_SIZE), REGION_SIZE_CHUNKS)
const SWEEP = [...COORDS].sort(
  ([ax, az], [bx, bz]) => tile_of(ax) - tile_of(bx) || tile_of(az) - tile_of(bz) || ax - bx || az - bz
)

/** A world block id read from the real generated chunk, or null when this column skips that probe. */
const generated_block = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => {
  if (y < 0 || y >= WORLD_HEIGHT) return null
  const chunk = generate_world_chunk(floor_div(x, CHUNK_SIZE), floor_div(y, CHUNK_SIZE), floor_div(z, CHUNK_SIZE))
  return get_block_id(chunk, local(x), local(y), local(z))
}

const COLUMNS = SWEEP.map(([x, z]) => {
  const y = ground_height(DEFAULT_WORLD_GEN_CONFIG, x, z)
  const gtop = build_column_profile(default_ctx, floor_div(x, CHUNK_SIZE), floor_div(z, CHUNK_SIZE)).ground_top[
    column_index(local(x), local(z))
  ]
  // Skips the rare beach-waterline band (the world_gen beach-flatten polish lifts those dry only in
  // the generated chunk, not in the un-flattened column math the oracle mirrors).
  const in_beach_band = y >= SEA_LEVEL - 2 && y <= SEA_LEVEL + 3
  return {
    y,
    gtop,
    below: in_beach_band ? null : generated_block(x, y - 1, z),
    // the block AT the sea surface over a CLEARLY-submerged seabed (see the fluid-rejection test).
    at_sea_surface: y < SEA_LEVEL && gtop <= SEA_LEVEL - 2 ? generated_block(x, SEA_LEVEL - 1, z) : null,
  }
})

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
    for (const { y, gtop } of COLUMNS) {
      if (y === gtop) exact += 1
      max_diff = Math.max(max_diff, Math.abs(y - gtop))
    }
    expect(exact).toBeGreaterThanOrEqual(98)
    expect(max_diff).toBeLessThanOrEqual(2)
  })

  test('the analytic y lands on real generated voxels — block below is solid terrain', () => {
    // The block at (ground_height − 1) is a solid, non-fluid TERRAIN block in the real generated chunk.
    let checked = 0
    for (const { below } of COLUMNS) {
      if (below === null) continue // beach-flatten band or out of world — skipped in the pass above
      expect(below).not.toBe(0) // not air — real geometry sits here
      expect(SOLID_FLUIDS.has(below)).toBe(false) // and it is not a fluid
      checked += 1
    }
    expect(checked).toBeGreaterThan(50)
  })
})

describe('binding/ground_height — fluid rejection (§4)', () => {
  test('ocean columns return the SEABED, never the sea plane', () => {
    // Find columns whose ground sits below sea level; the oracle must report the solid seabed (< sea),
    // and in the generated chunk the block at ground_height itself is water/air (the seabed is beneath).
    let ocean = 0
    for (const { y, gtop, at_sea_surface } of COLUMNS) {
      if (y >= SEA_LEVEL) continue
      ocean += 1
      expect(y).toBeLessThan(SEA_LEVEL) // NOT clamped to the water surface
      // the generator agrees this column's terrain top is the seabed (fluids excluded).
      expect(Math.abs(y - gtop)).toBeLessThanOrEqual(2)
      // the block AT the sea surface above this seabed is water in the generated chunk (proves fluid sits
      // above the returned ground, and the oracle rejected it). GUARD (GEN_VERSION 12 flat-smooth): only for
      // a CLEARLY-submerged seabed (gtop ≤ SEA_LEVEL−2, the `at_sea_surface` probe's gate) — a column the
      // oracle rounds just under sea while the chunk seabed rounds to the waterline (within the ±2
      // oracle/chunk tolerance above) is a SHOAL, where the block at SEA_LEVEL−1 is legitimately its own
      // solid top, not a fluid cell (boundary, not a bug).
      if (at_sea_surface !== null) expect(at_sea_surface === 5 || at_sea_surface === 0).toBe(true) // water (or air where a wave-carved cell)
    }
    expect(ocean).toBeGreaterThan(0)
  })
})
