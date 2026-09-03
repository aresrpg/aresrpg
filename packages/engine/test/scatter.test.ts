// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { chunk_scatter } from '../src/scatter.ts'
import type { StructurePlacement } from '../src/structure_placement.ts'
import { BIOME_SLOTS, compile_world_recipe, sample_world_column, type WorldRecipe } from '../src/world_recipe.ts'

const world_with = (surface_preset: 'grass' | 'frozen_grass' | 'ice', sea_level = 8) =>
  compile_world_recipe({
    seed: 'scatter-test',
    sea_level,
    materials: {
      rock: { color: '#787878', preset: 'stone' },
      soil: { color: '#6e4f38', preset: 'earth' },
      cover: { color: surface_preset === 'grass' ? '#5c8c3c' : '#a8d4e6', preset: surface_preset },
    },
    biome_slots: Object.fromEntries(BIOME_SLOTS.map((slot) => [slot, 'test'])) as WorldRecipe['biome_slots'],
    biomes: [
      {
        name: 'test',
        landscape: [
          { x: 0, y: 0, land: { surface: 'cover', subsurface: 'soil', filler: 'rock' } },
          { x: 1, y: 20 },
        ],
      },
    ],
  })

describe('ground scatter', () => {
  test('is deterministic for the same world and chunk', () => {
    const world = world_with('grass')
    expect(chunk_scatter(world, [0, 0, 0])).toEqual(chunk_scatter(world, [0, 0, 0]))
  })

  test('grows preset-matched kinds on the owning surface chunk, above sea level', () => {
    const world = world_with('grass')
    const instances = [0, 32, 64].flatMap((x) => [...chunk_scatter(world, [x, 0, 0])])
    expect(instances.length).toBeGreaterThan(0)
    instances.forEach((instance) => {
      expect(['tuft', 'bush', 'flower']).toContain(instance.kind)
      const column = sample_world_column(world, Math.floor(instance.x), Math.floor(instance.z))
      expect(instance.y).toBe(column.surface_y)
      expect(column.surface_y).toBeGreaterThan(world.recipe.sea_level)
      expect(column.surface_y - 1).toBeLessThan(32)
    })
  })

  test('derives tuft colors from the authored surface color', () => {
    const world = world_with('grass')
    const tuft = chunk_scatter(world, [0, 0, 0]).find(({ kind }) => kind === 'tuft')!
    const surface = world.materials.entries[world.materials.id_for('cover')]!.color
    expect(tuft.color[1] / tuft.color[0]).toBeCloseTo(surface[1] / surface[0], 5)
    expect(tuft.accent[1]).toBeGreaterThan(tuft.color[1])
  })

  test('an ice surface grows only spikes', () => {
    const world = world_with('ice')
    const instances = [0, 32, 64].flatMap((x) => [...chunk_scatter(world, [x, 0, 0])])
    expect(instances.length).toBeGreaterThan(0)
    instances.forEach(({ kind }) => expect(kind).toBe('spike'))
  })

  test('frozen grass keeps vegetation out and grows only icy clutter', () => {
    const world = world_with('frozen_grass')
    const instances = [0, 32, 64].flatMap((x) => [...chunk_scatter(world, [x, 0, 0])])
    expect(instances.length).toBeGreaterThan(0)
    instances.forEach(({ kind }) => expect(['pebble', 'spike']).toContain(kind))
  })

  test('chunks that do not contain the surface stay bare', () => {
    const world = world_with('grass')
    expect(chunk_scatter(world, [0, 96, 0])).toEqual([])
  })

  test('columns under a structure footprint stay bare', () => {
    const world = world_with('grass')
    const footprint = {
      overlap_bounds: { min_x: 0, max_x: 15, min_y: 0, max_y: 64, min_z: 0, max_z: 31 },
    } as StructurePlacement
    const instances = chunk_scatter(world, [0, 0, 0], [footprint])
    instances.forEach(({ x }) => expect(x).toBeGreaterThan(16))
    expect(instances.length).toBeLessThan(chunk_scatter(world, [0, 0, 0]).length)
  })

  test('submerged terrain stays bare', () => {
    const world = world_with('grass', 30)
    expect(chunk_scatter(world, [0, 0, 0])).toEqual([])
  })

  test('a city replaces biome grass with land-use-specific nature', () => {
    const world = compile_world_recipe({
      seed: 'city-scatter-test',
      sea_level: 8,
      materials: {
        rock: { color: '#787878', preset: 'stone' },
        soil: { color: '#6e4f38', preset: 'earth' },
        cover: { color: '#5c8c3c', preset: 'grass' },
        thebes_limestone: { color: '#d7c39a', preset: 'stone' },
        thebes_sandstone: { color: '#b98254', preset: 'stone' },
        thebes_tile: { color: '#247d86', preset: 'stone' },
        thebes_copper: { color: '#aa654c', preset: 'stone' },
        temperate_wood: { color: '#765038', preset: 'wood' },
      },
      biome_slots: Object.fromEntries(BIOME_SLOTS.map((slot) => [slot, 'test'])) as WorldRecipe['biome_slots'],
      biomes: [
        {
          name: 'test',
          landscape: [
            { x: 0, y: 20, land: { surface: 'cover', subsurface: 'soil', filler: 'rock' } },
            { x: 1, y: 20 },
          ],
        },
      ],
      structure_areas: [
        {
          id: 'thebes',
          min_x: 0,
          max_x: 95,
          min_z: 0,
          max_z: 31,
          anchor_x: 16,
          anchor_z: 16,
          structure_packs: [],
        },
      ],
    })
    const instances = [0, 32, 64].flatMap((x) => [...chunk_scatter(world, [x, 0, 0])])

    expect(instances.length).toBeGreaterThan(0)
    instances.forEach(({ kind }) =>
      expect(['dry_reed', 'city_shrub', 'pebble', 'field_crop', 'flower']).toContain(kind)
    )
    expect(instances.some(({ kind }) => kind === 'field_crop')).toBeTrue()
  })
})
