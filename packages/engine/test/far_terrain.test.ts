// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The far shell's hole must track the EFFECTIVE chunk radius (the player's render-distance
// override), never the quality tier's default — 2026-08-20: a lowered distance left the tier
// hole gaping past the voxels, and a raised one overlapped double terrain.

import { describe, expect, test } from 'bun:test'
import { Scene, type Mesh } from 'three'

import { effective_render_distance, get_quality_profile } from '../src/quality.ts'
import { create_far_terrain, ring_indices, seam_radius } from '../src/far_terrain.ts'
import { create_clouds } from '../src/clouds.ts'
import { create_sky_node } from '../src/sky/sky_node.ts'
import { compile_runtime_world_recipe, parse_world_recipe } from '../src/world_recipe.ts'
import { world_terrain } from '../src/world_catalog.ts'
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

test('radius changes preserve vertex data and reuse the index allocation', () => {
  const scene = new Scene()
  const sky = create_sky_node()

  const clouds = create_clouds({ scene, sky, quality: 'high', seed: 'flat-coverage' })
  const world = parse_world_recipe(world_terrain('nauvis'))
  const far = create_far_terrain({
    scene,
    quality: 'high',

    clouds,
    sun_direction: sky.sun_direction,
    world,
    materials: compile_runtime_world_recipe(world, { structures: false }).materials,
  })
  try {
    const { geometry } = scene.children.at(-1)! as Mesh
    const vertices = geometry.getAttribute('position')
    const retained_index = geometry.index
    far.set_quality('high', 1)
    expect(geometry.getAttribute('position')).toBe(vertices)
    expect(geometry.index).toBe(retained_index)
    expect(Array.from(geometry.index!.array.slice(0, geometry.drawRange.count))).toEqual(ring_indices('high', 1))
  } finally {
    far.dispose()
    clouds.dispose()
  }
})
