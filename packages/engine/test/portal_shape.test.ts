// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { load_generated_city_artifacts } from '../src/cities/generated_city.ts'
import { portal_frame_source, portal_opening_columns, PORTAL_ARCH, dungeon_gate_position } from '../src/portal_shape.ts'
import { compile_world_recipe, sample_world_column } from '../src/world_recipe.ts'
import { world_terrain } from '../src/world_catalog.ts'
import { structure_placements, for_each_structure_voxel } from '../src/structure_placement.ts'

test('every effect column fits exactly beneath its solid arch without closing the passage', () => {
  const source = portal_frame_source('stone'),
    [ax, ay, az] = source.anchor
  const cells = new Set(source.blocks.map(([x, y, z]) => `${x - ax},${y - ay},${z - az}`))
  for (const { x, height } of portal_opening_columns()) {
    for (let y = 0; y < height; y++) expect(cells.has(`${x},${y},0`)).toBe(false)
    expect(cells.has(`${x},${height},0`)).toBe(true)
  }
  expect(cells.has(`${PORTAL_ARCH.half_width},1,0`)).toBe(true)
})
test('the portal frame uses ordinary terrain occupancy and disappears when the recipe disables the portal', async () => {
  await load_generated_city_artifacts()
  const world = compile_world_recipe(world_terrain('nauvis')),
    area = { min_x: -10, max_x: 10, min_z: -10, max_z: 10 }
  const frame = structure_placements(world, area).find((p) => p.id === 'world-portal-frame')!
  const floor = sample_world_column(world, 0, 0).surface_y,
    cells = new Set<string>()
  for_each_structure_voxel(frame, (x, y, z) => cells.add(`${x},${y},${z}`))
  expect(cells.has(`${PORTAL_ARCH.half_width},${floor + 1},0`)).toBe(true)
  expect(cells.has(`0,${floor + 1},0`)).toBe(false)
  const disabled = compile_world_recipe({ ...world.recipe, portal: false })
  expect(structure_placements(disabled, area).some((p) => p.id === 'world-portal-frame')).toBe(false)
})

test('dungeon arches use ordinary voxel occupancy, demonic materials and invariant material IDs', async () => {
  await load_generated_city_artifacts()
  const recipe = world_terrain('nauvis')
  const world = compile_world_recipe(recipe)
  const without_structures = compile_world_recipe(recipe, { structures: false })
  expect(without_structures.materials.entries).toEqual(world.materials.entries)
  const { x, z } = dungeon_gate_position(512, 0)
  const frame = structure_placements(world, { min_x: x - 8, max_x: x + 8, min_z: z - 3, max_z: z + 3 }).find(
    ({ id }) => id === 'dungeon-portal-frame:thebes'
  )!
  expect(frame).toBeDefined()
  const floor = sample_world_column(world, x, z).surface_y
  const cells = new Map<string, number>()
  for_each_structure_voxel(frame, (vx, vy, vz, material) => cells.set(`${vx - x},${vy - floor},${vz - z}`, material))
  expect(cells.has('0,1,0')).toBe(false)
  expect(world.materials.entries[cells.get('4,1,0')!]!.name).toStartWith('dungeon_')
  expect([...cells.values()].some((id) => world.materials.entries[id]!.emission > 0)).toBe(true)
  expect(cells.has('0,1,-5')).toBe(false)
})
