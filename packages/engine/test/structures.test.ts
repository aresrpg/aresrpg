// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import worlds from '../../../seed/content/worlds.json'
import { for_each_structure_voxel, structure_placements } from '../src/structure_placement.ts'
import { STRUCTURE_PACKS, STRUCTURE_TYPES } from '../src/structures.ts'
import { generate_chunk, surface_chunk_layers } from '../src/terrain_generator.ts'
import { CHUNK_EDGE, voxel_index } from '../src/voxel_data.ts'
import { preview_sample_plan } from '../src/world_preview.ts'
import { compile_world_recipe, parse_world_recipe, type WorldRecipe } from '../src/world_recipe.ts'

const land = { surface: 'grass', subsurface: 'dirt', filler: 'stone' } as const
const recipe = {
  seed: 'structure-test',
  sea_level: 60,
  materials: {
    grass: { color: '#668047', preset: 'grass' },
    dirt: { color: '#654d36', preset: 'earth' },
    stone: { color: '#707777', preset: 'stone' },
  },
  biome_slots: {
    low_low: 'temperate',
    low_mid: 'temperate',
    low_high: 'temperate',
    mid_low: 'temperate',
    mid_mid: 'temperate',
    mid_high: 'temperate',
    high_low: 'temperate',
    high_mid: 'temperate',
    high_high: 'temperate',
  },
  biomes: [
    {
      name: 'temperate',
      structure_packs: ['temperate_ruins'],
      landscape: [
        { x: 0, y: 62, land },
        { x: 1, y: 62 },
      ],
    },
  ],
} as const satisfies WorldRecipe

describe('voxel structures', () => {
  test('loads every preprocessed type through human-editable packs', () => {
    expect(Object.keys(STRUCTURE_TYPES)).toHaveLength(168)
    expect(STRUCTURE_PACKS.temperate_trees?.types.length).toBeGreaterThan(5)
    expect(STRUCTURE_PACKS.temperate_ruins?.types).toEqual([{ type: 'temperate_ruined_arch', weight: 1 }])
  })

  test('Nauvis packs omit schematics that contradict its temperate biomes', () => {
    expect(STRUCTURE_PACKS.nauvis_plains_trees?.types.some(({ type }) => type.includes('acacia'))).toBeFalse()
    expect(
      STRUCTURE_PACKS.nauvis_highland_trees?.types.some(({ type }) => STRUCTURE_TYPES[type]?.palette.includes('snow'))
    ).toBeFalse()
    expect(STRUCTURE_PACKS.nauvis_rainforest_rocks?.types.some(({ type }) => type.includes('corail'))).toBeFalse()
    expect(STRUCTURE_PACKS.nauvis_desert_scrub?.types.some(({ type }) => type.includes('cactus'))).toBeFalse()
  })

  test('surface-only consumers skip structure decoding without changing climate truth', () => {
    const complete = compile_world_recipe(recipe)
    const surface_only = compile_world_recipe(recipe, { structures: false })

    expect(surface_only.structures.packs).toHaveLength(0)
    expect(surface_only.sample_climate(123, -456)).toEqual(complete.sample_climate(123, -456))
  })

  test('populates every Nauvis biome with an intentional atmosphere pack', () => {
    const nauvis = worlds.find(({ world }) => world === 'nauvis')
    if (!nauvis?.terrain) throw new Error('Nauvis terrain is missing')
    const compiled = compile_world_recipe(parse_world_recipe(nauvis.terrain))

    expect(
      compiled.biomes.every(({ name, structure_packs = [] }) =>
        name === 'ocean' ? structure_packs.length === 0 : structure_packs.length > 0
      )
    ).toBeTrue()
    expect(new Set(compiled.structures.packs.map(({ category }) => category))).toEqual(
      new Set(['trees', 'rocks', 'ruins'])
    )
  })

  test('Nauvis keeps forests dense and its spawn plain open', () => {
    const nauvis = worlds.find(({ world }) => world === 'nauvis')
    if (!nauvis?.terrain) throw new Error('Nauvis terrain is missing')
    const compiled = compile_world_recipe(parse_world_recipe(nauvis.terrain))
    const forest = structure_placements(compiled, { min_x: -3072, max_x: -2561, min_z: -4096, max_z: -3585 }).filter(
      ({ pack }) => pack === 'temperate_trees'
    )
    const spawn_forest = structure_placements(compiled, { min_x: -128, max_x: 128, min_z: -128, max_z: 128 }).filter(
      ({ pack }) => pack.endsWith('_trees')
    )

    expect(forest.length).toBeGreaterThan(600)
    expect(forest.filter(({ type }) => type.size[1] >= 30).length).toBeGreaterThan(250)
    expect(spawn_forest.length).toBeGreaterThan(5)
    expect(spawn_forest.length).toBeLessThan(40)
    expect(spawn_forest.every(({ pack }) => pack === 'nauvis_plains_trees')).toBeTrue()
  })

  test('Nauvis never places a tree footprint below sea level', () => {
    const nauvis = worlds.find(({ world }) => world === 'nauvis')
    if (!nauvis?.terrain) throw new Error('Nauvis terrain is missing')
    const compiled = compile_world_recipe(parse_world_recipe(nauvis.terrain))
    const trees = structure_placements(compiled, { min_x: -1024, max_x: 1024, min_z: -1024, max_z: 1024 }).filter(
      ({ pack }) => pack.endsWith('_trees')
    )

    expect(trees.length).toBeGreaterThan(0)
    expect(trees.every(({ origin }) => origin[1] >= nauvis.terrain.sea_level)).toBeTrue()
  }, 15_000)

  test('places the same non-overlapping structures for the same world area', () => {
    const world = compile_world_recipe(recipe)
    const first = structure_placements(world, { min_x: -1024, max_x: 1024, min_z: -1024, max_z: 1024 })
    const second = structure_placements(world, { min_x: -1024, max_x: 1024, min_z: -1024, max_z: 1024 })

    expect(first).toEqual(second)
    expect(first.length).toBeGreaterThan(2)
    first.forEach((placement, index) => {
      const overlaps = first
        .slice(index + 1)
        .some(
          (other) =>
            !(
              placement.bounds.max_x < other.bounds.min_x ||
              placement.bounds.min_x > other.bounds.max_x ||
              placement.bounds.max_z < other.bounds.min_z ||
              placement.bounds.min_z > other.bounds.max_z
            )
        )
      expect(overlaps).toBeFalse()
    })
  })

  test('extends residency and writes structure voxels into their exact chunks', () => {
    const world = compile_world_recipe(recipe)
    const [placement] = structure_placements(world, { min_x: -1024, max_x: 1024, min_z: -1024, max_z: 1024 })
    if (!placement) throw new Error('test structure placement is missing')
    const above_ground: (readonly [number, number, number, number])[] = []
    for_each_structure_voxel(placement, (x, y, z, material_id) => {
      if (y > 64) above_ground.push([x, y, z, material_id])
    })
    const [voxel] = above_ground
    if (!voxel) throw new Error('test structure has no voxel above its ground')
    const [x, y, z, material_id] = voxel
    const coordinate = {
      x: Math.floor(x / CHUNK_EDGE),
      y: Math.floor(y / CHUNK_EDGE),
      z: Math.floor(z / CHUNK_EDGE),
    }
    const layers = surface_chunk_layers(world, coordinate.x, coordinate.z)
    const chunk = generate_chunk(world, { key: 'structure', coordinate, lod: 'near' })
    const local_x = x - coordinate.x * CHUNK_EDGE
    const local_y = y - coordinate.y * CHUNK_EDGE
    const local_z = z - coordinate.z * CHUNK_EDGE

    expect(layers).toContain(coordinate.y)
    expect(chunk.material_ids[voxel_index(local_x, local_y, local_z)]).toBe(material_id)
  })

  test('feeds the same structures into the live admin terrain preview', () => {
    const world = compile_world_recipe(recipe)
    const [placement] = structure_placements(world, { min_x: -1024, max_x: 1024, min_z: -1024, max_z: 1024 })
    if (!placement) throw new Error('test structure placement is missing')
    const plan = preview_sample_plan(recipe, {
      focus_x: placement.origin[0],
      focus_z: placement.origin[2],
      near_radius: 16,
      far_radius: 32,
      far_step: 16,
    })

    expect(plan.structures.length).toBeGreaterThan(0)
  })
})
