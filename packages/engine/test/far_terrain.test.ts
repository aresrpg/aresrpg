// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The far shell's hole must track the EFFECTIVE chunk radius (the player's render-distance
// override), never the quality tier's default — 2026-08-20: a lowered distance left the tier
// hole gaping past the voxels, and a raised one overlapped double terrain.

import { describe, expect, test } from 'bun:test'

import { effective_render_distance, get_quality_profile } from '../src/quality.ts'
import { ring_indices, seam_radius } from '../src/far_terrain.ts'
import { CHUNK_EDGE } from '../src/voxel_data.ts'

describe('the far shell hole', () => {
  test('opens exactly where the effective chunk radius ends', () => {
    expect(seam_radius(6)).toBe(6 * CHUNK_EDGE - CHUNK_EDGE)
    // the derivation door: override wins, tier default fills its absence
    expect(effective_render_distance(get_quality_profile('high').chunks.far_radius, 6)).toBe(6)
    expect(effective_render_distance(get_quality_profile('high').chunks.far_radius, null)).toBe(11)
  })

  test('a smaller radius closes the hole — more shell quads cover what voxels no longer do', () => {
    // high tier defaults to radius 11; a player override of 6 must SHRINK the hole
    const tier_default = ring_indices('high', 11).length
    const overridden = ring_indices('high', 6).length
    expect(overridden).toBeGreaterThan(tier_default)
    // and the same effective radius yields the same hole regardless of how it was reached
    expect(ring_indices('high', 6)).toEqual(ring_indices('high', effective_render_distance(11, 6)))
  })
})
