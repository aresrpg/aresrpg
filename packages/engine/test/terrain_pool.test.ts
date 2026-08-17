// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import worlds from '../../../seed/content/worlds.json'
import { greedy_mesh } from '../src/greedy_mesher.ts'
import { get_quality_profile } from '../src/quality.ts'
import { generate_chunk, surface_chunk_layers } from '../src/terrain_generator.ts'
import { TERRAIN_POOL_LAYOUT } from '../src/terrain_pool.ts'
import { compile_world_recipe, parse_world_recipe } from '../src/world_recipe.ts'

test('the shared terrain pool fits First Shore high-quality residency', () => {
  const first_world = worlds.find(({ world }) => world === '01_first_shore')
  if (!first_world) throw new Error('First Shore is missing')
  const compiled = compile_world_recipe(parse_world_recipe(first_world.terrain))
  const radius = get_quality_profile('high').chunks.far_radius
  let required_slots = 0

  for (let z = -radius; z <= radius; z += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      surface_chunk_layers(compiled, x, z).forEach((y) => {
        const request = { key: `${x}:${y}:${z}`, coordinate: { x, y, z }, lod: 'near' as const }
        const { quad_count } = greedy_mesh(generate_chunk(compiled, request))
        required_slots += Math.ceil(quad_count / TERRAIN_POOL_LAYOUT.slot_quads)
      })
    }
  }

  expect(required_slots).toBeLessThanOrEqual(TERRAIN_POOL_LAYOUT.max_slots)
}, 15_000)
