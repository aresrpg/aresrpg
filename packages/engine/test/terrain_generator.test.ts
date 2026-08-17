// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { chunk_origin, generate_chunk, surface_chunk_layers } from '../src/terrain_generator.ts'
import { BIOME_SLOTS, compile_world_recipe, type WorldRecipe } from '../src/world_recipe.ts'

const WORLD = compile_world_recipe({
  seed: 'terrain-test',
  sea_level: 8,
  materials: {
    rock: { color: '#787878', preset: 'stone' },
    soil: { color: '#6e4f38', preset: 'earth' },
    meadow: { color: '#5c8c3c', preset: 'grass' },
    blades: { color: '#668844', preset: 'grass' },
  },
  biome_slots: Object.fromEntries(BIOME_SLOTS.map((slot) => [slot, 'test'])) as WorldRecipe['biome_slots'],
  biomes: [
    {
      name: 'test',
      landscape: [
        { x: 0, y: 0, land: { surface: 'meadow', subsurface: 'soil', filler: 'rock' } },
        { x: 1, y: 20 },
      ],
    },
  ],
})

describe('terrain generation', () => {
  test('uses absolute 32-block chunk layers inside the 384-block world', () => {
    expect(chunk_origin({ x: 2, y: 11, z: -3 })).toEqual([64, 352, -96])
    expect(surface_chunk_layers(WORLD, 0, 0)).toEqual([0])
  })

  test('derives every vertical layer crossed by a tall surface cliff', () => {
    const cliff = {
      ...WORLD,
      biomes: WORLD.biomes.map((biome) => ({
        ...biome,
        height_points: [
          [0, 1],
          [1, 100],
        ] as const,
      })),
      sample_climate: (x: number) => ({
        temperature: 0.5,
        humidity: 0.5,
        ground: x < 16 ? 0 : 1,
        amplitude: 0.5,
        transition: 0.5,
      }),
    }

    expect(surface_chunk_layers(cliff, 0, 0)).toEqual([0, 1, 2, 3])
  })

  test('never plans chunks outside the authored world-height domain', () => {
    const floor = compile_world_recipe({
      ...WORLD.recipe,
      biomes: WORLD.recipe.biomes.map((biome) => ({
        ...biome,
        landscape: biome.landscape.map((knot) => ({ ...knot, y: 0 })),
      })),
    })

    expect(surface_chunk_layers(floor, 0, 0)).toEqual([0])
  })

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
