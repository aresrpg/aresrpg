// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { generate_chunk } from '../src/terrain_generator.ts'
import { compile_world_recipe, type WorldRecipe } from '../src/world_recipe.ts'

const WORLD = compile_world_recipe({
  seed: 'terrain-test',
  sea_level: 8,
  vertical_chunks: [0],
  materials: {
    rock: '#787878',
    soil: '#6e4f38',
    meadow: '#5c8c3c',
    blades: '#668844',
  },
  noise: Object.fromEntries(
    ['temperature', 'humidity', 'continentalness', 'erosion', 'weirdness'].map((name) => [
      name,
      { period: 256, octaves: 2 },
    ])
  ) as WorldRecipe['noise'],
  splines: {
    continentalness_to_base: [
      [0, 0],
      [1, 20],
    ],
    erosion_to_amplitude: [
      [0, 8],
      [1, 1],
    ],
    pv_to_relief: [
      [0, -0.2],
      [1, 1],
    ],
  },
  biome_selection: {
    axis_weights: { temperature: 1, humidity: 1, continentalness: 0.6, erosion: 0.5, pv: 0.4 },
    blend_k: 1,
    transition_softness: 0.6,
  },
  biomes: [
    {
      name: 'test',
      climate: { temperature: 0.5, humidity: 0.5, continentalness: 0.5, erosion: 0.5, pv: 0.5 },
      weight: 1,
      land: { surface: 'meadow', subsurface: 'soil', filler: 'rock' },
    },
  ],
})

describe('terrain generation', () => {
  test('terrain and its neighbour halo are deterministic', () => {
    const request = { key: '-2:0:5', coordinate: { x: -2, y: 0, z: 5 }, lod: 'mid' as const }
    const first = generate_chunk(WORLD, request)

    expect(first).toEqual(generate_chunk(WORLD, request))
    expect(first.occupancy[0]).toHaveLength(1024)
    expect(first.material_ids).toHaveLength(32 ** 3)
    expect(new Set(first.material_ids).size).toBeGreaterThan(2)
    expect(first.halo_occupancy).toHaveLength(Math.ceil(34 ** 3 / 32))
  })

  test('direct terrain labels keep one crack-free voxel resolution', () => {
    const coordinate = { x: 0, y: 0, z: 0 }
    const chunks = (['near', 'mid', 'far'] as const).map((lod) =>
      generate_chunk(WORLD, { key: `0:0:0:${lod}`, coordinate, lod })
    )

    expect(new Set(chunks.map(({ resolution }) => resolution))).toEqual(new Set([32]))
    expect(new Set(chunks.map(({ cell_size }) => cell_size))).toEqual(new Set([1]))
  })
})
