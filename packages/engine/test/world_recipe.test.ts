// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { sample_biome_cell, sample_biome_grid } from '../src/biome_grid.ts'
import {
  BIOME_SLOTS,
  balance_climate,
  biome_influences,
  CLIMATE_FIELDS,
  climate_band_weights,
  compile_world_recipe,
  landscape_height,
  MAX_SURFACE_Y,
  sample_world_column,
  surface_layer_for_slope,
  validate_world_recipe,
  WORLD_HEIGHT,
  type WorldRecipe,
} from '../src/world_recipe.ts'

const shore_land = { surface: 'shore', subsurface: 'shore', filler: 'rock' } as const
const meadow_land = { surface: 'meadow', subsurface: 'soil', filler: 'rock' } as const

test('surface cover yields to authored lower strata as terrain gets steeper', () => {
  expect(surface_layer_for_slope(0)).toBe('surface')
  expect(surface_layer_for_slope(1.99)).toBe('surface')
  expect(surface_layer_for_slope(2)).toBe('subsurface')
  expect(surface_layer_for_slope(3.99)).toBe('subsurface')
  expect(surface_layer_for_slope(4)).toBe('filler')
})

const RECIPE = {
  seed: 'first-shore',
  sea_level: 8,
  materials: {
    rock: { color: '#787878', preset: 'stone' },
    soil: { color: '#6e4f38', preset: 'earth' },
    meadow: { color: '#5c8c3c', preset: 'grass' },
    shore: { color: '#d6c794', preset: 'sand' },
    water: { color: '#2e609e', preset: 'water' },
  },
  liquid: 'water',
  biome_slots: {
    low_low: 'shore',
    low_mid: 'meadow',
    low_high: 'meadow',
    mid_low: 'meadow',
    mid_mid: 'meadow',
    mid_high: 'meadow',
    high_low: 'meadow',
    high_mid: 'meadow',
    high_high: 'meadow',
  },
  biomes: [
    {
      name: 'shore',
      landscape: [
        { x: 0, y: 10, land: shore_land },
        { x: 0.5, y: 10 },
        { x: 1, y: 10 },
      ],
    },
    {
      name: 'meadow',
      landscape: [
        { x: 0, y: 30, land: meadow_land },
        { x: 0.5, y: 30, land: { ...meadow_land, surface: 'shore' }, variance: 0.04 },
        { x: 1, y: 30 },
      ],
    },
  ],
} as const satisfies WorldRecipe

const OCEAN_RECIPE = {
  ...RECIPE,
  ocean: { biome: 'ocean', ground_max: 0.25 },
  biomes: [
    ...RECIPE.biomes,
    {
      name: 'ocean',
      landscape: [
        { x: 0, y: 2, land: shore_land },
        { x: 1, y: 7 },
      ],
    },
  ],
} as const satisfies WorldRecipe

const controlled_world = (
  recipe: WorldRecipe,
  climate: ReturnType<ReturnType<typeof compile_world_recipe>['sample_climate']>,
  ridge = 0.5
) => {
  const world = compile_world_recipe(recipe)
  return { ...world, sample_climate: () => climate, sample_ridges: () => ridge }
}

describe('world recipes', () => {
  test('climate spreads into broad territories on legacy-scale fields, never middle-band slivers', () => {
    // Bands: whole territories with blended borders, not slivers.
    expect(climate_band_weights(0.29)).toEqual({ low: 1, mid: 0, high: 0 })
    expect(climate_band_weights(0.35).low).toBeCloseTo(0.5)
    expect(climate_band_weights(0.35).mid).toBeCloseTo(0.5)
    expect(climate_band_weights(0.5)).toEqual({ low: 0, mid: 1, high: 0 })
    expect(climate_band_weights(0.65).mid).toBeCloseTo(0.5)
    expect(climate_band_weights(0.65).high).toBeCloseTo(0.5)
    expect(climate_band_weights(0.71)).toEqual({ low: 0, mid: 0, high: 1 })

    // Balancing pushes the extremes out without narrowing that middle territory.
    expect(balance_climate(0.4)).toBeCloseTo(0.35)
    expect(balance_climate(0.5)).toBe(0.5)
    expect(balance_climate(0.6)).toBeCloseTo(0.65)

    // …over detailed fields, not locally planar continents.
    expect(CLIMATE_FIELDS).toEqual({
      temperature: { period: 8192, octaves: 6, spread: 2, gain: 0.5 },
      humidity: { period: 8192, octaves: 6, spread: 2, gain: 0.5 },
    })
  })

  test('validates landscape points, materials, slots and removed engine controls together', () => {
    const result = validate_world_recipe({
      ...RECIPE,
      noise: {},
      vertical_chunks: [0],
      biome_slots: { ...RECIPE.biome_slots, high_high: 'missing' },
      biomes: [
        {
          ...RECIPE.biomes[0],
          mountain_passes: 'yes',
          ravines: 'yes',
          landscape: [
            { x: 0.5, y: 1, land: { ...shore_land, surface: 'missing' } },
            { x: 0.5, y: 2 },
          ],
        },
      ],
    })

    expect(result.errors).toEqual(
      expect.arrayContaining([
        'noise is engine-owned and must not be authored',
        'vertical_chunks is engine-owned and must not be authored',
        'biomes[0].mountain_passes must be a boolean',
        'biomes[0].ravines must be a boolean',
        'biomes[0].landscape[0].land.surface references unknown material "missing"',
        'biomes[0].landscape[1].x must be strictly greater than the previous x',
        'biome_slots.high_high must reference an authored biome',
      ])
    )
  })

  test('rejects unknown structure packs at the biome that references them', () => {
    const result = validate_world_recipe({
      ...RECIPE,
      biomes: RECIPE.biomes.map((biome, index) =>
        index === 0 ? { ...biome, structure_packs: ['missing_pack'] } : biome
      ),
    })

    expect(result.errors).toContain('biomes[0].structure_packs[0] references unknown pack "missing_pack"')
  })

  test('keeps the nine climate slots explicit and complete', () => {
    expect(BIOME_SLOTS).toHaveLength(9)
    expect(validate_world_recipe(RECIPE)).toEqual({ ok: true, errors: [] })
  })

  test('linearly interpolates the authored landscape', () => {
    const points = [
      [0, 10],
      [0.25, 20],
      [0.75, 30],
      [1, 40],
    ] as const

    expect(landscape_height(points, -1)).toBe(10)
    expect(landscape_height(points, 0.25)).toBe(20)
    expect(landscape_height(points, 1)).toBe(40)
    expect(landscape_height(points, 0.5)).toBe(25)
  })

  test('blends the four climate-grid neighbours before voxel rounding', () => {
    const climate = { temperature: 0.35, humidity: 0.35, ground: 0.5, amplitude: 0.5, transition: 0.5 }
    const world = controlled_world(RECIPE, climate)
    const influences = biome_influences(world, climate)

    expect(influences[0]?.biome.name).toBe('meadow')
    expect(influences[0]?.weight).toBeCloseTo(0.75)
    expect(influences[1]?.biome.name).toBe('shore')
    expect(influences[1]?.weight).toBeCloseTo(0.25)
    expect(sample_world_column(world, 0, 0).surface_y).toBe(25)
  })

  test('selects a real ocean biome from ground before land climate', () => {
    const ocean = controlled_world(OCEAN_RECIPE, {
      temperature: 0.5,
      humidity: 0.5,
      ground: 0.2,
      amplitude: 0.5,
      transition: 0.5,
    })
    const land = controlled_world(OCEAN_RECIPE, {
      temperature: 0.5,
      humidity: 0.5,
      ground: 0.4,
      amplitude: 0.5,
      transition: 0.5,
    })

    expect(sample_world_column(ocean, 0, 0).biome.name).toBe('ocean')
    expect(sample_world_column(ocean, 0, 0).surface_y).toBeLessThan(OCEAN_RECIPE.sea_level)
    expect(sample_world_column(land, 0, 0).biome.name).toBe('meadow')
  })

  test('uses one absolute 384-block height domain and clamps procedural detail inside it', () => {
    expect(WORLD_HEIGHT).toBe(384)
    expect(MAX_SURFACE_Y).toBe(383)
    const low = controlled_world(RECIPE, {
      temperature: 0.5,
      humidity: 0.5,
      ground: 0,
      amplitude: 0,
      transition: 0.5,
    })
    const high_recipe = {
      ...RECIPE,
      biomes: RECIPE.biomes.map((biome) => ({
        ...biome,
        landscape: biome.landscape.map((knot) => ({ ...knot, y: MAX_SURFACE_Y })),
      })),
    } satisfies WorldRecipe
    const high = controlled_world(high_recipe, {
      temperature: 0.5,
      humidity: 0.5,
      ground: 1,
      amplitude: 1,
      transition: 0.5,
    })

    expect(sample_world_column(low, 0, 0).surface_y).toBeGreaterThanOrEqual(1)
    expect(sample_world_column(high, 0, 0).surface_y).toBe(MAX_SURFACE_Y)
  })

  test('ridge carving scales with mountain relief without roughening lowlands', () => {
    const climate = { temperature: 0.5, humidity: 0.5, ground: 1, amplitude: 0.5, transition: 0.5 }
    const ridge_range = (height: number) => {
      const recipe = {
        ...RECIPE,
        sea_level: 60,
        biomes: RECIPE.biomes.map((biome) => ({
          ...biome,
          landscape: biome.landscape.map((knot) => ({ ...knot, y: height })),
        })),
      } satisfies WorldRecipe
      const valley = sample_world_column(controlled_world(recipe, climate, 0), 0, 0).surface_y
      const crest = sample_world_column(controlled_world(recipe, climate, 1), 0, 0).surface_y
      return crest - valley
    }

    expect(ridge_range(90)).toBeLessThanOrEqual(12)
    expect(ridge_range(260)).toBeGreaterThanOrEqual(120)
  })

  test('carves a rare mountain pass through the canonical surface without raising low ground', () => {
    const climate = { temperature: 0.5, humidity: 0.5, ground: 1, amplitude: 0.5, transition: 0.5 }
    const mountain_recipe = {
      ...RECIPE,
      seed: 'pass-0',
      sea_level: 60,
      biomes: RECIPE.biomes.map((biome) => ({
        ...biome,
        mountain_passes: biome.name === 'meadow',
        landscape: biome.landscape.map((knot) => ({ ...knot, y: 260 })),
      })),
    } satisfies WorldRecipe
    const plain_recipe = {
      ...mountain_recipe,
      biomes: mountain_recipe.biomes.map((biome) => ({ ...biome, mountain_passes: false })),
    } satisfies WorldRecipe
    const carved = controlled_world(mountain_recipe, climate, 0.44)
    const plain = controlled_world(plain_recipe, climate, 0.44)

    expect(sample_world_column(plain, 984, 398).surface_y).toBe(260)
    expect(sample_world_column(carved, 984, 398).surface_y).toBeLessThan(220)
    expect(sample_world_column(carved, 0, 0).surface_y).toBe(260)
  })

  test('cuts rare deep ravines without creating a second terrain surface', () => {
    const climate = { temperature: 0.5, humidity: 0.5, ground: 1, amplitude: 0.5, transition: 0.5 }
    const ravine_recipe = {
      ...RECIPE,
      seed: 'ravine-0',
      sea_level: 60,
      biomes: RECIPE.biomes.map((biome) => ({
        ...biome,
        ravines: biome.name === 'meadow',
        landscape: biome.landscape.map((knot) => ({ ...knot, y: 180 })),
      })),
    } satisfies WorldRecipe
    const plain_recipe = {
      ...ravine_recipe,
      biomes: ravine_recipe.biomes.map((biome) => ({ ...biome, ravines: false })),
    } satisfies WorldRecipe
    const carved = controlled_world(ravine_recipe, climate, 0.44)
    const plain = controlled_world(plain_recipe, climate, 0.44)

    expect(sample_world_column(plain, 760, 480).surface_y).toBe(180)
    expect(sample_world_column(carved, 760, 480).surface_y).toBeLessThan(120)
    expect(sample_world_column(carved, 0, 0).surface_y).toBe(180)
  })

  test('selects block strata from a landscape threshold with real variance', () => {
    const before = controlled_world(RECIPE, {
      temperature: 0.5,
      humidity: 0.5,
      ground: 0.49,
      amplitude: 0.5,
      transition: 1,
    })
    const after = controlled_world(RECIPE, {
      temperature: 0.5,
      humidity: 0.5,
      ground: 0.53,
      amplitude: 0.5,
      transition: 1,
    })

    expect(sample_world_column(before, 0, 0).land.surface).toBe('meadow')
    expect(sample_world_column(after, 0, 0).land.surface).toBe('shore')
  })

  test('compiles once and samples deterministically without mutating the recipe', () => {
    const world = compile_world_recipe(RECIPE)
    const first = sample_world_column(world, 137, -91)

    expect(first).toEqual(sample_world_column(world, 137, -91))
    expect(first.surface_y).toBeInteger()
    expect(first.surface_id).toBe(world.materials.id_for(first.land.surface, 'surface', first.land.subsurface))
    expect(structuredClone(RECIPE)).toEqual(RECIPE)
  })

  test('traverses an authored elevation curve inside one admin voxel field', () => {
    const relief = {
      ...RECIPE,
      biomes: RECIPE.biomes.map((biome) => ({
        ...biome,
        landscape: [
          { x: 0, y: 0, land: biome.landscape[0]!.land! },
          { x: 0.5, y: 50 },
          { x: 1, y: 100 },
        ],
      })),
    } satisfies WorldRecipe
    const world = compile_world_recipe(relief)
    const heights = Array.from({ length: 97 * 97 }, (_, index) => {
      const x = (index % 97) * 8 - 384 + 50_000
      const z = Math.floor(index / 97) * 8 - 384 + 50_000
      return sample_world_column(world, x, z).surface_y
    })

    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThanOrEqual(45)
  })

  test('derives the chain biome grid from the same compiled sampler', () => {
    const grid = sample_biome_grid(RECIPE, { world_size: 1024, world_center: 512, cell_size: 512 })

    expect(grid.side).toBe(2)
    expect(grid.cells).toHaveLength(4)
    expect([...grid.cells].every((biome) => biome < RECIPE.biomes.length)).toBeTrue()
    const world = compile_world_recipe(RECIPE, { structures: false })
    expect(sample_biome_cell(world, 1, 0, { world_center: 512, cell_size: 512 })).toBe(grid.cells[1])
  })
})
