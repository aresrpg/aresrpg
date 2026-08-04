// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SPARSE ≡ DENSE COLUMN EQUIVALENCE — the far-shell contract (§3.7 sibling of the golden hash).
// The far LOD sampler (lod/section_builder.js) taps SPARSE columns through fill_profile_column
// instead of building full 1024-column chunk profiles (the far-fill lever: far sections read only
// 64/chunk at L4, 256/chunk at L3). That is only legal because the extracted per-column body
// computes identical values regardless of grid context: a 1-cell sparse fill in a FRESH context
// (own priming via prime_column_footprint) must equal the dense build_column_profile grid entry,
// field for field — on the DEFAULT world (slope/glacier/region layers null) AND on everest (every
// slope-driven layer active). A regression here = the far shell silently forking from the near ring.

import { test, expect, describe } from 'bun:test'

import { CHUNK_SIZE } from '../../src/config/world_config.js'
import { column_index } from '../../src/chunks/format.js'
import { EVEREST_WORLD } from '../../src/config/worlds/everest.js'
import {
  create_gen_context,
  build_column_profile,
  create_column_profile,
  fill_profile_column,
  prime_column_footprint,
} from '../../src/gen/column_gen.js'

/** @typedef {import('../../src/gen/column_gen.js').ColumnProfile} ColumnProfile */

/** Chunk footprints compared (a canonical spawn chunk + two scattered ones from the golden set). */
const CHUNKS = [
  [0, 0],
  [12, -7],
  [40, 40],
]

/** Per-field mismatch counters — a failure names the diverging field, not just "not equal".
 * @returns {Record<string, number>} */
function zero_counters() {
  return {
    layer_shape: 0, // slope/glacier/region_ice null-ness disagrees between sparse and dense
    surface_y: 0,
    biome_id: 0,
    strata: 0,
    water_level: 0,
    waterfall: 0,
    ground_top: 0,
    slope: 0,
    glacier: 0,
    region_ice: 0,
    density: 0, // DensityColumn scalars (drive is_solid — the sky scan + occupancy oracle)
  }
}

/**
 * Tallies mismatches for ONE column: the sparse 1-cell fill (index 0) vs the dense grid entry (ci).
 * @param {ColumnProfile} cell @param {ColumnProfile} dense @param {number} ci
 * @param {Record<string, number>} bad
 * @returns {void}
 */
function tally_column(cell, dense, ci, bad) {
  if (cell.surface_y[0] !== dense.surface_y[ci]) bad.surface_y += 1
  if (cell.biome_id[0] !== dense.biome_id[ci]) bad.biome_id += 1
  for (let k = 0; k < 4; k += 1) if (cell.strata[k] !== dense.strata[ci * 4 + k]) bad.strata += 1
  if (cell.water_level[0] !== dense.water_level[ci]) bad.water_level += 1
  if (cell.waterfall[0] !== dense.waterfall[ci]) bad.waterfall += 1
  if (cell.ground_top[0] !== dense.ground_top[ci]) bad.ground_top += 1
  if (cell.slope !== null && dense.slope !== null && cell.slope[0] !== dense.slope[ci]) bad.slope += 1
  if (cell.glacier !== null && dense.glacier !== null && cell.glacier[0] !== dense.glacier[ci]) bad.glacier += 1
  if (cell.region_ice !== null && dense.region_ice !== null && cell.region_ice[0] !== dense.region_ice[ci])
    bad.region_ice += 1
  const [a] = cell.density
  const b = dense.density[ci]
  if (
    a.surface_y !== b.surface_y ||
    a.gate !== b.gate ||
    a.band_low !== b.band_low ||
    a.band_high !== b.band_high ||
    a.has_deep_caves !== b.has_deep_caves ||
    a.has_sky !== b.has_sky
  )
    bad.density += 1
}

/**
 * Compares every column of chunk (cx,cz): dense grid (its own context) vs sparse taps (a fresh
 * context + the reused 1-cell scratch — exactly the far sampler's shape).
 * @param {import('../../src/gen/column_gen.js').GenContext} dense_ctx
 * @param {import('../../src/gen/column_gen.js').GenContext} sparse_ctx
 * @param {ColumnProfile} cell @param {Record<string, number>} bad
 * @param {number} cx @param {number} cz
 * @returns {void}
 */
function tally_chunk(dense_ctx, sparse_ctx, cell, bad, cx, cz) {
  const dense = build_column_profile(dense_ctx, cx, cz)
  if (
    (cell.slope === null) !== (dense.slope === null) ||
    (cell.glacier === null) !== (dense.glacier === null) ||
    (cell.region_ice === null) !== (dense.region_ice === null)
  )
    bad.layer_shape += 1
  prime_column_footprint(sparse_ctx, cx, cz)
  for (let z = 0; z < CHUNK_SIZE; z += 1) {
    for (let x = 0; x < CHUNK_SIZE; x += 1) {
      const ci = column_index(x, z)
      fill_profile_column(sparse_ctx, cell, 0, cx * CHUNK_SIZE + x, cz * CHUNK_SIZE + z)
      tally_column(cell, dense, ci, bad)
    }
  }
}

describe('sparse ≡ dense: fill_profile_column equals the build_column_profile grid entry', () => {
  /** @type {[string, import('../../src/config/world_gen_config.js').WorldGenConfig | undefined][]} */
  const CASES = [
    ['default', undefined],
    ['everest', EVEREST_WORLD],
  ]

  for (const [name, config] of CASES) {
    test(`${name}: every column of ${CHUNKS.length} chunks matches, dense grid vs sparse taps`, () => {
      const dense_ctx = config ? create_gen_context(config) : create_gen_context()
      const sparse_ctx = config ? create_gen_context(config) : create_gen_context()
      const cell = create_column_profile(sparse_ctx, 1)
      const bad = zero_counters()
      for (const [cx, cz] of CHUNKS) tally_chunk(dense_ctx, sparse_ctx, cell, bad, cx, cz)
      expect(bad).toEqual(zero_counters())
    })
  }
})
