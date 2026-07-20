// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// NG-LOD sky-island proof (survey S2 — sky islands get a coarse 3D shell lane). The far-shell
// pipeline must carry the Pandora floating islands (v5) that the ground heightmap structurally cannot.
// This test PROVES the islands are reachable from the column/density modules alone (no phase-B GPU
// sampling needed):
//
//   (1) DENSITY CHANNEL — density.is_solid, evaluated over the sky band [low_y±thickness], returns
//       solid voxels high above terrain for the columns UNDER an archipelago. This is the ONLY channel
//       that exposes them (ColumnProfile.ground_top deliberately excludes the sky band; see
//       resolve_ground_top in column_gen.js). create_world_column_sampler scans exactly this band, so
//       a positive here means the far sampler recovers the islands.
//   (2) SECTION LAYER — a section built over a column that carries an island cap has sky_cells>0 and a
//       non-null sky_height/sky_block layer at the island's CAP altitude (in the cap band [low_y,high_y]).
//   (3) far_mesher then emits a second top+skirt layer for those cells (covered in far_mesher.test.js).
//
// v5 region-gating: islands are NOT scattered everywhere — they belong to sky-island REGIONS. A blind
// origin scan can land on a root-tip column (low sky_top) or miss the archipelago entirely, so this
// test uses the SAME region hash the generator uses (region_islands) to locate a real archipelago
// deterministically, then aims the sampler at a known island CAP. If the region gate ever yields no
// islands, or the density channel can't recover a located island, this FAILS LOUD (no fake success).

import { test, expect, describe } from 'bun:test'

import { create_gen_context } from '../gen/column_gen.js'
import { DENSITY_CONFIG } from '../gen/density.js'
import { region_islands } from '../gen/sky_islands.js'

import { build_section, create_world_column_sampler, LOD_MAX_LEVEL } from './section_builder.js'

const SKY = DENSITY_CONFIG.sky

/**
 * Locates a real island CAP near origin using the generator's own region hash — the deterministic
 * replacement for a blind grid scan (v5 islands are region-gated, not everywhere). Returns the
 * biggest island of the nearest sky-island region (its cap is the tallest, most reliable target).
 * @param {import('../gen/column_gen.js').GenContext} ctx
 * @returns {import('../gen/sky_islands.js').SkyIsland}
 */
function locate_island_cap(ctx) {
  const found = []
  const R = 8 // region cells to search around origin
  for (let rz = -R; rz <= R; rz += 1) {
    for (let rx = -R; rx <= R; rx += 1) {
      const islands = region_islands(ctx.density.sky, rx, rz)
      if (islands.length > 0) found.push({ rx, rz, d2: rx * rx + rz * rz, islands })
    }
  }
  if (found.length === 0) throw new Error('no sky-island region within reach — region gate is broken')
  found.sort((a, b) => a.d2 - b.d2)
  // Biggest cap of the nearest archipelago = the surest column to carry a tall sky layer.
  return found[0].islands.reduce((a, b) => (b.cap_r > a.cap_r ? b : a))
}

describe('Pandora sky islands are reachable from column/density modules (region-gated)', () => {
  test('the cap altitude band is enabled with a plausible high-altitude range', () => {
    // Guards against a sibling gen change silently disabling the feature the far lane must carry.
    expect(SKY.enabled).toBe(true)
    expect(SKY.low_y).toBeGreaterThan(200) // well above sea level (128)
    expect(SKY.high_y).toBeGreaterThan(SKY.low_y)
  })

  test('(1) density channel: the world sampler recovers a located island cap as solid sky', () => {
    const ctx = create_gen_context('aresrpg')
    const sampler = create_world_column_sampler(ctx)
    const cap = locate_island_cap(ctx)
    // Sample the sampler on a small grid around the island axis; SOME column must carry a sky layer.
    let best = null
    for (let dz = -SKY.cap_radius_max; dz <= SKY.cap_radius_max && !best; dz += 4) {
      for (let dx = -SKY.cap_radius_max; dx <= SKY.cap_radius_max; dx += 4) {
        const s = sampler(cap.cx + dx, cap.cz + dz)
        if (s.sky_top > 0) {
          best = s
          break
        }
      }
    }
    // No fake success: a located archipelago the far sampler cannot recover is a real bug.
    if (!best) throw new Error('located an island but the far sampler found no sky column over it')
    expect(best.sky_top).toBeGreaterThan(SKY.low_y - SKY.thickness)
    expect(best.sky_top).toBeLessThanOrEqual(SKY.high_y + SKY.thickness + 1)
    expect(best.sky_block).toBeGreaterThan(0)
  })

  test('(2) section layer: a section over the archipelago carries a sky layer at cap altitude', () => {
    const ctx = create_gen_context('aresrpg')
    const sampler = create_world_column_sampler(ctx)
    const cap = locate_island_cap(ctx)

    // Build the L4 section whose footprint contains the island axis.
    const span = 32 * (1 << LOD_MAX_LEVEL) // section_span_meters(4) = 512
    const sx = Math.floor(cap.cx / span)
    const sz = Math.floor(cap.cz / span)
    const section = build_section(sampler, LOD_MAX_LEVEL, sx, sz)

    expect(section.sky_cells).toBeGreaterThan(0)
    expect(section.sky_height).not.toBeNull()
    expect(section.sky_block).not.toBeNull()
    // The tallest sky cell reaches the island's CAP band (well above sea level 128), proving a real
    // hanging-mountain top — not a clipped root tip.
    const highest = Math.max(...Array.from(/** @type {Uint16Array} */ (section.sky_height)))
    expect(highest).toBeGreaterThan(SKY.low_y) // in the cap band (≥ low_y = 300)
  })
})
