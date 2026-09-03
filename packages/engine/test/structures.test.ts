// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import worlds from '../../../seed/content/worlds.json'
import fuwage_map from '../src/cities/generated/fuwage_map.json'
import { generated_city_land_use, load_generated_city_artifacts } from '../src/cities/generated_city.ts'
import {
  city_map_overlays,
  for_each_structure_voxel,
  structure_placements,
  structure_voxels,
} from '../src/structure_placement.ts'
import { STRUCTURE_PACKS, STRUCTURE_TYPES } from '../src/structures.ts'
import { generate_chunk, surface_chunk_layers } from '../src/terrain_generator.ts'
import { CHUNK_EDGE, voxel_index } from '../src/voxel_data.ts'
import { preview_sample_plan } from '../src/world_preview.ts'
import {
  compile_world_recipe,
  parse_world_recipe,
  sample_world_column,
  WORLD_HEIGHT,
  type WorldRecipe,
} from '../src/world_recipe.ts'

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
    expect(Object.keys(STRUCTURE_TYPES)).toHaveLength(178)
    expect(STRUCTURE_PACKS.temperate_trees?.types.length).toBeGreaterThan(5)
    expect(STRUCTURE_PACKS.temperate_ruins?.types).toEqual([{ type: 'temperate_ruined_arch', weight: 1 }])
  })

  test('gives every Nauvis land biome a sparse colossal landmark family', () => {
    const packs = ['plains', 'forest', 'rainforest', 'highland', 'desert'].map(
      (biome) => STRUCTURE_PACKS[`nauvis_${biome}_landmarks`]!
    )

    expect(
      packs.every(({ spacing, density_bp, scale }) =>
        Boolean(spacing >= 896 && density_bp <= 6500 && scale?.[0] === 3 && scale[1] === 5)
      )
    ).toBeTrue()
    expect(packs.every(({ types }) => types.length === 2)).toBeTrue()
    expect(
      packs.every(({ types }) =>
        types.every(({ type }) => {
          const structure = STRUCTURE_TYPES[type]!
          return (
            Math.max(...structure.size) >= 42 && structure.size[0] * structure.size[1] * structure.size[2] <= 65_535
          )
        })
      )
    ).toBeTrue()
    expect(
      packs.flatMap(({ types }) => types.map(({ type }) => type)).filter((type) => /fang|tusk/.test(type))
    ).toEqual([])
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

  test('a fixed city area activates its authored packs independently of the biome pool', () => {
    const city_recipe = {
      ...recipe,
      structure_areas: [
        {
          id: 'thebes',
          min_x: -512,
          max_x: 511,
          min_z: -512,
          max_z: 511,
          structure_packs: ['temperate_ruins'],
        },
      ],
      biomes: recipe.biomes.map((biome) => ({ ...biome, structure_packs: [] })),
    } satisfies WorldRecipe
    const compiled = compile_world_recipe(city_recipe)
    const placements = structure_placements(compiled, { min_x: -512, max_x: 511, min_z: -512, max_z: 511 })

    expect(placements.some(({ pack }) => pack === 'temperate_ruins')).toBeTrue()
    expect(compiled.structures.packs.find(({ name }) => name === 'temperate_ruins')?.fixed_areas[0]?.id).toBe('thebes')
  })

  test('keeps every structure footprint outside the world-origin portal radius', () => {
    const compiled = compile_world_recipe(recipe)
    const dense_world = Object.freeze({
      ...compiled,
      structures: Object.freeze({
        ...compiled.structures,
        packs: Object.freeze(
          compiled.structures.packs.map((pack) => Object.freeze({ ...pack, spacing: 8, density_bp: 10_000 }))
        ),
      }),
    })
    const placements = structure_placements(dense_world, { min_x: -32, max_x: 32, min_z: -32, max_z: 32 })
    const distance_squared = ({ min_x, max_x, min_z, max_z }: (typeof placements)[number]['bounds']) => {
      const nearest_x = Math.max(min_x, Math.min(0, max_x))
      const nearest_z = Math.max(min_z, Math.min(0, max_z))
      return nearest_x * nearest_x + nearest_z * nearest_z
    }

    expect(placements.length).toBeGreaterThan(0)
    expect(placements.every(({ bounds }) => distance_squared(bounds) > 10 * 10)).toBeTrue()
  })

  test('generated city land use covers both axes of rectangular landmarks', () => {
    const plateau = fuwage_map.map.find(({ type }) => type === 'fuwage_plateau')
    if (!plateau) throw new Error('Fuwage plateau is missing')

    expect(generated_city_land_use('fuwage', plateau.max_x - 8, plateau.max_z - 8)).toBe('plateau')
  })

  test('builds Thebes from deterministic procedural block structures at its authored anchor', async () => {
    await load_generated_city_artifacts()
    const nauvis = worlds.find(({ world }) => world === 'nauvis')
    if (!nauvis?.terrain) throw new Error('Nauvis terrain is missing')
    const terrain = {
      ...structuredClone(nauvis.terrain),
      structure_areas: [
        {
          id: 'thebes',
          min_x: -336,
          max_x: 1199,
          min_z: -848,
          max_z: 687,
          anchor_x: 512,
          anchor_z: 0,
          structure_packs: ['temperate_trees', 'temperate_ruins'],
        },
      ],
    }
    const compiled = compile_world_recipe(parse_world_recipe(terrain))
    const area = { min_x: 360, max_x: 640, min_z: -120, max_z: 120 }
    const first = structure_placements(compiled, area).filter(({ pack }) => pack === 'city:thebes')
    const second = structure_placements(compiled, area).filter(({ pack }) => pack === 'city:thebes')
    const garden_trees = structure_placements(compiled, compiled.structures.cities[0]!.area).filter(({ pack }) =>
      pack.endsWith('_trees')
    )
    const city_materials = new Set(
      compiled.materials.entries.filter(({ name }) => name.startsWith('thebes_')).map(({ name }) => name)
    )
    const overlay = city_map_overlays(compiled)[0]!
    const city_types = new Set(overlay.structures.map(({ type }) => type.replace(/_\d+$/, '')))
    const portal_blocks: (readonly [number, number, number])[] = []
    first
      .filter(({ bounds }) => bounds.min_x <= 512 && bounds.max_x >= 512 && bounds.min_z <= 0 && bounds.max_z >= 0)
      .forEach((placement) =>
        for_each_structure_voxel(placement, (x, y, z) => {
          if (Math.abs(x - 512) <= 4 && Math.abs(z) <= 4 && y >= sample_world_column(compiled, x, z).surface_y)
            portal_blocks.push([x, y, z])
        })
      )

    expect(first).toEqual(second)
    expect(first.length).toBeGreaterThan(10)
    expect(garden_trees.length).toBeGreaterThan(10)
    garden_trees.forEach(({ origin }) => expect(generated_city_land_use('thebes', origin[0], origin[2])).toBe('garden'))
    expect([...city_types].sort()).toEqual(
      [
        'thebes_dungeon_plaza',
        'thebes_road',
        'thebes_gate',
        'thebes_wall',
        'thebes_field',
        'thebes_garden',
        'thebes_river',
        'thebes_bridge',
        'thebes_house',
        'thebes_tower',
        'thebes_wood',
        'thebes_barracks',
        'thebes_watchtower',
        'thebes_town_hall',
        'thebes_castle',
        'thebes_market',
        'thebes_temple',
        'thebes_ruin',
      ].sort()
    )
    expect(overlay.bounds).toEqual({ min_x: -336, max_x: 1199, min_z: -848, max_z: 687 })
    expect(portal_blocks).toEqual([])
    expect(city_materials).toEqual(new Set(['thebes_limestone', 'thebes_sandstone', 'thebes_tile', 'thebes_copper']))
    expect(
      structure_voxels(compiled, area).some(({ material_id }) =>
        city_materials.has(compiled.materials.entries[material_id]!.name)
      )
    ).toBeTrue()
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
    expect(
      compiled.biomes
        .filter(({ name }) => name !== 'ocean')
        .every(({ structure_packs = [] }) => structure_packs.some((pack) => pack.endsWith('_landmarks')))
    ).toBeTrue()
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

  test('varies colossal landmark scale and rotation while keeping spawn and the world ceiling clear', () => {
    const nauvis = worlds.find(({ world }) => world === 'nauvis')
    if (!nauvis?.terrain) throw new Error('Nauvis terrain is missing')
    const compiled = compile_world_recipe(parse_world_recipe(nauvis.terrain))
    const packs = compiled.structures.packs.filter(({ name }) => name.endsWith('_landmarks'))
    const landmark_world = Object.freeze({
      ...compiled,
      structures: Object.freeze({ packs: Object.freeze(packs), cities: Object.freeze([]) }),
    })
    const placements = structure_placements(landmark_world, {
      min_x: -8_192,
      max_x: 8_192,
      min_z: -8_192,
      max_z: 8_192,
    })

    expect(new Set(placements.map(({ scale }) => scale))).toEqual(new Set([3, 4, 5]))
    expect(new Set(placements.map(({ rotation }) => rotation))).toEqual(new Set([0, 1, 2, 3]))
    expect(new Set(placements.map(({ pack }) => pack))).toEqual(new Set(packs.map(({ name }) => name)))
    expect(placements.every(({ bounds }) => bounds.min_y >= 0 && bounds.max_y < WORLD_HEIGHT)).toBeTrue()
    expect(
      placements.every(({ bounds }) =>
        Boolean(bounds.max_x < -512 || bounds.min_x > 512 || bounds.max_z < -512 || bounds.min_z > 512)
      )
    ).toBeTrue()
    const scaled = placements.find(({ scale }) => scale === 3)!
    const first_world_layer: (readonly [number, number, number, number])[] = []
    for_each_structure_voxel(scaled, (x, y, z, material_id) => first_world_layer.push([x, y, z, material_id]), {
      min: scaled.origin[1],
      max: scaled.origin[1],
    })
    const first_scaled_voxel = first_world_layer.slice(0, scaled.scale ** 2)
    expect(new Set(first_scaled_voxel.map(([x]) => x)).size).toBe(scaled.scale)
    expect(new Set(first_scaled_voxel.map(([, y]) => y))).toEqual(new Set([scaled.origin[1]]))
    expect(new Set(first_scaled_voxel.map(([, , z]) => z)).size).toBe(scaled.scale)
  })

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
