// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { validate_fixed_structures } from '../src/fixed_structures.ts'
import { structure_placements, structure_voxels, for_each_structure_voxel } from '../src/structure_placement.ts'
import { BIOME_SLOTS, compile_world_recipe, type WorldRecipe } from '../src/world_recipe.ts'

const materials = { stone: { color: '#607080', preset: 'stone' as const } }
const source = {
  name: 'scaled_rock',
  size: [2, 1, 1],
  anchor: [1, 0, 0],
  blocks: [
    [0, 0, 0, 'stone'],
    [1, 0, 0, 'air'],
  ],
} as const
const placement = { source, origin: [128, 72, 128], rotation: 1, scale: 3 } as const

test('fixed structures reject fractional and unbounded scaling', () => {
  for (const scale of [0, -1, 1.5, 6, '2', NaN]) {
    expect(validate_fixed_structures([{ ...placement, scale }], materials)).toContain(
      'fixed_structures[0].scale must be an integer in 1..5'
    )
  }
  expect(validate_fixed_structures([placement], materials)).toEqual([])
})

test('fixed scaling shares rotated bounds and explicit air with ordinary structure voxels after worker cloning', () => {
  const recipe: WorldRecipe = {
    seed: 'fixed-scale',
    sea_level: 1,
    materials,
    biome_slots: Object.fromEntries(BIOME_SLOTS.map((slot) => [slot, 'rock'])) as WorldRecipe['biome_slots'],
    biomes: [
      {
        name: 'rock',
        landscape: [
          { x: 0, y: 20, land: { surface: 'stone', subsurface: 'stone', filler: 'stone' } },
          { x: 1, y: 20 },
        ],
      },
    ],
    fixed_structures: [placement],
  }
  const world = compile_world_recipe(structuredClone(recipe))
  const area = { min_x: 120, max_x: 140, min_z: 120, max_z: 140 }
  const [placed] = structure_placements(world, area)
  const voxels = structure_voxels(world, area)
  expect(placed!.scale).toBe(3)
  expect(voxels.filter(({ material_id }) => material_id > 0)).toHaveLength(27)
  expect(voxels.filter(({ material_id }) => material_id === 0)).toHaveLength(27)
  expect(
    voxels.every(
      ({ x, y, z }) =>
        x >= placed!.bounds.min_x &&
        x <= placed!.bounds.max_x &&
        y >= placed!.bounds.min_y &&
        y <= placed!.bounds.max_y &&
        z >= placed!.bounds.min_z &&
        z <= placed!.bounds.max_z
    )
  ).toBeTrue()
  expect(structure_voxels(world, { min_x: 100, max_x: 101, min_z: 100, max_z: 101 })).toEqual([])
})

test('scenery without a travel gate does not carve a portal-sized hole through authored structures', () => {
  const recipe: WorldRecipe = {
    seed: 'no-portal',
    sea_level: 0,
    portal: false,
    materials,
    biome_slots: Object.fromEntries(BIOME_SLOTS.map((slot) => [slot, 'rock'])) as WorldRecipe['biome_slots'],
    biomes: [
      {
        name: 'rock',
        landscape: [
          { x: 0, y: 20, land: { surface: 'stone', subsurface: 'stone', filler: 'stone' } },
          { x: 1, y: 20 },
        ],
      },
    ],
    fixed_structures: [{ ...placement, origin: [0, 32, 0], rotation: 0, scale: 1 }],
  }
  const area = { min_x: -10, max_x: 10, min_z: -10, max_z: 10 }
  expect(structure_voxels(compile_world_recipe(recipe), area)).toHaveLength(2)
  const authored = structure_placements(compile_world_recipe({ ...recipe, portal: true }), area).find(
    (p) => p.id === 'fixed:0'
  )!
  let emitted = 0
  for_each_structure_voxel(authored, () => emitted++)
  expect(emitted).toBe(0)
})
