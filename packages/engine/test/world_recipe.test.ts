// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { sample_biome_grid } from '../src/biome_grid.ts'
import {
  catmull_rom,
  compile_world_recipe,
  sample_world_column,
  validate_world_recipe,
  type WorldRecipe,
} from '../src/world_recipe.ts'

const RECIPE = {
  seed: 'first-shore',
  sea_level: 8,
  vertical_chunks: [0],
  materials: {
    rock: '#787878',
    soil: '#6e4f38',
    meadow: '#5c8c3c',
    shore: '#d6c794',
    blades: '#587a45',
    water: '#2e609e',
  },
  liquid: 'water',
  noise: {
    temperature: { period: 256, octaves: 2 },
    humidity: { period: 256, octaves: 2 },
    continentalness: { period: 512, octaves: 3 },
    erosion: { period: 256, octaves: 2 },
    weirdness: { period: 128, octaves: 2 },
  },
  splines: {
    continentalness_to_base: [
      [0, 4],
      [0.5, 12],
      [1, 20],
    ],
    erosion_to_amplitude: [
      [0, 8],
      [1, 0],
    ],
    pv_to_relief: [
      [0, -0.25],
      [1, 1],
    ],
  },
  biome_selection: {
    axis_weights: { temperature: 1, humidity: 1, continentalness: 0.6, erosion: 0.5, pv: 0.4 },
    blend_k: 2,
    transition_softness: 0.6,
  },
  biomes: [
    {
      name: 'shore',
      climate: { temperature: 0.7, humidity: 0.5, continentalness: 0.3, erosion: 0.8, pv: 0.4 },
      weight: 1,
      land: { surface: 'shore', subsurface: 'shore', filler: 'rock' },
    },
    {
      name: 'meadow',
      climate: { temperature: 0.6, humidity: 0.7, continentalness: 0.7, erosion: 0.7, pv: 0.5 },
      weight: 1,
      land: { surface: 'meadow', subsurface: 'soil', filler: 'rock' },
    },
  ],
} as const satisfies WorldRecipe

describe('world recipes', () => {
  test('validates every structural problem in one pass', () => {
    const result = validate_world_recipe({
      ...RECIPE,
      noise: { ...RECIPE.noise, erosion: { period: 0, octaves: 17 } },
      splines: {
        ...RECIPE.splines,
        pv_to_relief: [
          [0.5, 0],
          [0.5, 1],
        ],
      },
      liquid: 'missing',
      biomes: [{ ...RECIPE.biomes[0], land: { ...RECIPE.biomes[0].land, surface: 'missing' } }],
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'noise.erosion.period must be greater than zero',
        'noise.erosion.octaves must be an integer from 1 to 16',
        'splines.pv_to_relief[1][0] must be strictly greater than the previous x',
        'liquid references unknown material "missing"',
        'biomes[0].land.surface references unknown material "missing"',
      ])
    )
  })

  test('rejects biome-selection values that cannot produce an influence', () => {
    const result = validate_world_recipe({
      ...RECIPE,
      noise: {
        ...RECIPE.noise,
        humidity: { ...RECIPE.noise.humidity, spread: 0, gain: -1 },
      },
      biome_selection: {
        axis_weights: { ...RECIPE.biome_selection.axis_weights, humidity: -1 },
        blend_k: 0,
        transition_softness: Number.NaN,
      },
      biomes: [{ ...RECIPE.biomes[0], weight: 0, climate: { ...RECIPE.biomes[0].climate, pv: Number.NaN } }],
    })

    expect(result.errors).toEqual(
      expect.arrayContaining([
        'noise.humidity.spread must be greater than zero',
        'noise.humidity.gain must be greater than zero',
        'biome_selection.axis_weights.humidity must be a finite non-negative number',
        'biome_selection.blend_k must be an integer from 1 to the biome count',
        'biome_selection.transition_softness must be a finite non-negative number',
        'biomes[0].weight must be greater than zero',
        'biomes[0].climate.pv must be a finite number',
      ])
    )
  })

  test('keeps the accepted Catmull-Rom point behavior', () => {
    const points = [
      [0, 10],
      [0.25, 20],
      [0.75, 30],
      [1, 40],
    ] as const

    expect(catmull_rom(points, -1)).toBe(10)
    expect(catmull_rom(points, 0.25)).toBe(20)
    expect(catmull_rom(points, 1)).toBe(40)
    expect(catmull_rom(points, 0.5)).toBe(25)
  })

  test('compiles arbitrary recipe materials once and samples deterministically', () => {
    const world = compile_world_recipe(RECIPE)
    const first = sample_world_column(world, 137, -91)

    expect(first).toEqual(sample_world_column(world, 137, -91))
    expect(first.surface_y).toBeInteger()
    expect(world.materials.colors[0]).toEqual([0, 0, 0])
    expect(first.surface_id).toBe(
      world.materials.id_for(first.biome.land.surface, 'surface', first.biome.land.subsurface)
    )
    expect(structuredClone(RECIPE)).toEqual(RECIPE)
  })

  test('derives the chain biome grid from the same compiled sampler', () => {
    const grid = sample_biome_grid(RECIPE, { world_size: 1024, world_center: 512, cell_size: 512 })

    expect(grid.side).toBe(2)
    expect(grid.cells).toHaveLength(4)
    expect([...grid.cells].every((biome) => biome < RECIPE.biomes.length)).toBeTrue()
    expect([...sample_biome_grid(RECIPE, { world_size: 1024, world_center: 512, cell_size: 512 }).cells]).toEqual([
      ...grid.cells,
    ])
  })
})
