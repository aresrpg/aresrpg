// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import thebes_map from '../src/cities/generated/thebes_map.json'
import { generated_city_land_use } from '../src/cities/generated_city.ts'
import { chunk_scatter } from '../src/scatter.ts'
import { generate_chunk } from '../src/terrain_generator.ts'
import type { Vec3 } from '../src/types.ts'
import type { StructurePlacement } from '../src/structure_placement.ts'
import { structure_placements } from '../src/structure_placement.ts'
import {
  BIOME_SLOTS,
  compile_world_recipe,
  sample_world_column,
  type CompiledWorld,
  type WorldRecipe,
} from '../src/world_recipe.ts'

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

const scatter_at = (world: CompiledWorld, origin: Vec3, structures: readonly StructurePlacement[] = []) =>
  chunk_scatter(
    world,
    generate_chunk(
      world,
      { key: origin.join(':'), coordinate: { x: origin[0] / 32, y: origin[1] / 32, z: origin[2] / 32 }, lod: 'near' },
      structures
    )
  )

describe('ground scatter', () => {
  test('authored ground replacement selects the visible material rather than the buried biome material', () => {
    const base = world_with('grass')
    const world = compile_world_recipe({
      ...base.recipe,
      portal: false,
      materials: { ...base.recipe.materials, frozen: { color: '#a8d4e6', preset: 'ice' } },
      biomes: [
        {
          name: 'test',
          landscape: [
            { x: 0, y: 20, land: { surface: 'cover', subsurface: 'soil', filler: 'rock' } },
            { x: 1, y: 20 },
          ],
        },
      ],
      fixed_structures: [
        {
          source: {
            name: 'ice_sheet',
            size: [32, 1, 32],
            anchor: [0, 0, 0],
            blocks: Array.from({ length: 32 * 32 }, (_, index) => [index % 32, 0, Math.floor(index / 32), 'frozen']),
          },
          origin: [0, 19, 0],
          rotation: 0,
        },
      ],
    })
    const structures = structure_placements(world, { min_x: 0, max_x: 31, min_z: 0, max_z: 31 })
    const plants = scatter_at(world, [0, 0, 0], structures)
    expect(plants.length).toBeGreaterThan(0)
    expect(plants.every(({ kind }) => kind === 'spike')).toBe(true)
  })
  test('a baked soil plot grows plants in open cells, never through its fence or carved holes', () => {
    const base = world_with('grass')
    const soil = Array.from({ length: 32 * 32 }, (_, index) => [index % 32, 0, Math.floor(index / 32), 'cover'])
    const fence = Array.from({ length: 4 * 32 * 2 }, (_, index) => [
      index % 4,
      1 + Math.floor(index / 128),
      Math.floor(index / 4) % 32,
      'rock',
    ])
    const holes = Array.from({ length: 8 * 32 }, (_, index) => [24 + (index % 8), 0, Math.floor(index / 8), 'air'])
    const world = compile_world_recipe({
      ...base.recipe,
      portal: false,
      biomes: [
        {
          name: 'test',
          landscape: [
            { x: 0, y: 20, land: { surface: 'cover', subsurface: 'soil', filler: 'rock' } },
            { x: 1, y: 20 },
          ],
        },
      ],
      fixed_structures: [
        {
          source: { name: 'garden', size: [32, 3, 32], anchor: [0, 0, 0], blocks: [...soil, ...fence, ...holes] },
          origin: [0, 19, 0],
          rotation: 0,
        },
      ],
    })
    const structures = structure_placements(world, { min_x: 0, max_x: 31, min_z: 0, max_z: 31 })
    const plants = scatter_at(world, [0, 0, 0], structures)
    expect(plants.length).toBeGreaterThan(0)
    expect(plants.every(({ x }) => x >= 4 && x < 24)).toBe(true)
  })
  test('is deterministic for the same world and chunk', () => {
    const world = world_with('grass')
    expect(scatter_at(world, [0, 0, 0])).toEqual(scatter_at(world, [0, 0, 0]))
  })

  test('grows preset-matched kinds on the owning surface chunk, above sea level', () => {
    const world = world_with('grass')
    const instances = [0, 32, 64].flatMap((x) => [...scatter_at(world, [x, 0, 0])])
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
    const tuft = scatter_at(world, [0, 0, 0]).find(({ kind }) => kind === 'tuft')!
    const surface = world.materials.entries[world.materials.id_for('cover')]!.color
    expect(tuft.color[1] / tuft.color[0]).toBeCloseTo(surface[1] / surface[0], 5)
    expect(tuft.accent[1]).toBeGreaterThan(tuft.color[1])
  })

  test('an ice surface grows only spikes', () => {
    const world = world_with('ice')
    const instances = [0, 32, 64].flatMap((x) => [...scatter_at(world, [x, 0, 0])])
    expect(instances.length).toBeGreaterThan(0)
    instances.forEach(({ kind }) => expect(kind).toBe('spike'))
  })

  test('frozen grass keeps vegetation out and grows only icy clutter', () => {
    const world = world_with('frozen_grass')
    const instances = [0, 32, 64].flatMap((x) => [...scatter_at(world, [x, 0, 0])])
    expect(instances.length).toBeGreaterThan(0)
    instances.forEach(({ kind }) => expect(['pebble', 'spike']).toContain(kind))
  })

  test('chunks that do not contain the surface stay bare', () => {
    const world = world_with('grass')
    expect(scatter_at(world, [0, 96, 0])).toEqual([])
  })

  test('a solid voxel in the upper halo blocks plants on a chunk-boundary surface', () => {
    const base = world_with('grass')
    const world = compile_world_recipe({
      ...base.recipe,
      portal: false,
      biomes: [
        {
          name: 'test',
          landscape: [
            { x: 0, y: 32, land: { surface: 'cover', subsurface: 'soil', filler: 'rock' } },
            { x: 1, y: 32 },
          ],
        },
      ],
      fixed_structures: [
        {
          source: {
            name: 'roof',
            size: [16, 1, 32],
            anchor: [0, 0, 0],
            blocks: Array.from({ length: 16 * 32 }, (_, index) => [index % 16, 0, Math.floor(index / 16), 'rock']),
          },
          origin: [0, 32, 0],
          rotation: 0,
        },
      ],
    })
    const structures = structure_placements(world, { min_x: 0, max_x: 31, min_z: 0, max_z: 31 })
    const plants = scatter_at(world, [0, 0, 0], structures)
    expect(plants.length).toBeGreaterThan(0)
    expect(plants.every(({ x, y }) => x >= 16 && y === 32)).toBe(true)
  })

  test('submerged terrain stays bare', () => {
    const world = world_with('grass', 30)
    expect(scatter_at(world, [0, 0, 0])).toEqual([])
  })

  test('a city replaces biome grass with land-use-specific nature', () => {
    const world = compile_world_recipe(
      {
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
        structure_areas: [{ ...thebes_map.area, structure_packs: [] }],
      },
      { city_terrain: false }
    )
    const field = thebes_map.map.find(
      ({ type, min_x, min_z }) =>
        type === 'thebes_field' && generated_city_land_use('thebes', min_x + 8, min_z + 8) === 'field'
    )!
    const origin_x = Math.floor(field.min_x / 32) * 32
    const origin_z = Math.floor(field.min_z / 32) * 32
    const instances = [0, 32, 64]
      .flatMap((dx) => [...scatter_at(world, [origin_x + dx, 0, origin_z])])
      .filter(({ x, z }) => generated_city_land_use('thebes', x, z) === 'field')

    expect(instances.length).toBeGreaterThan(0)
    instances.forEach(({ kind }) =>
      expect(['dry_reed', 'city_shrub', 'pebble', 'field_crop', 'flower']).toContain(kind)
    )
    expect(instances.some(({ kind }) => kind === 'field_crop')).toBeTrue()
  })
})
