// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { sample_biome_grid } from '../src/biome_grid.ts'
import {
  BIOME_SLOTS,
  biome_influences,
  compile_world_recipe,
  landscape_height,
  MAX_SURFACE_Y,
  sample_world_column,
  validate_world_recipe,
  WORLD_HEIGHT,
  type WorldRecipe,
} from '../src/world_recipe.ts'

const shore_land = { surface: 'shore', subsurface: 'shore', filler: 'rock' } as const
const meadow_land = { surface: 'meadow', subsurface: 'soil', filler: 'rock' } as const
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

const controlled_world = (
  recipe: WorldRecipe,
  climate: ReturnType<ReturnType<typeof compile_world_recipe>['sample_climate']>
) => {
  const world = compile_world_recipe(recipe)
  return { ...world, sample_climate: () => climate }
}

describe('world recipes', () => {
  test('validates landscape points, materials, slots and removed engine controls together', () => {
    const result = validate_world_recipe({
      ...RECIPE,
      noise: {},
      vertical_chunks: [0],
      biome_slots: { ...RECIPE.biome_slots, high_high: 'missing' },
      biomes: [
        {
          ...RECIPE.biomes[0],
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
        'biomes[0].landscape[0].land.surface references unknown material "missing"',
        'biomes[0].landscape[1].x must be strictly greater than the previous x',
        'biome_slots.high_high must reference an authored biome',
      ])
    )
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
    const climate = { temperature: 0.43, humidity: 0.43, ground: 0.5, amplitude: 0.5, transition: 0.5 }
    const world = controlled_world(RECIPE, climate)
    const influences = biome_influences(world, climate)

    expect(influences[0]?.biome.name).toBe('meadow')
    expect(influences[0]?.weight).toBeCloseTo(0.75)
    expect(influences[1]?.biome.name).toBe('shore')
    expect(influences[1]?.weight).toBeCloseTo(0.25)
    expect(sample_world_column(world, 0, 0).surface_y).toBe(25)
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
  })
})
