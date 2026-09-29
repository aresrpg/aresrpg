// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import thebes_source from '../../../../seed/scenes/thebes.recipe.json'
import { compile_world_recipe, sample_world_column } from '../../src/world_recipe.ts'
import { world_terrain } from '../../src/world_catalog.ts'
import { compile_type } from '../../src/structures.ts'
import { place_tree } from '../../src/tree_placement.ts'

test('city trees reuse catalogue geometry without a separate branching generator', () => {
  const world = compile_world_recipe(world_terrain('nauvis'))
  const source = compile_type('temperate_large_tree_g1', world.materials)
  const tree = place_tree(world, source.name, 100, 70, 100, 1, 0)
  expect(tree.type.packed_voxels.length).toBe(source.packed_voxels.length)
  expect(tree.type.size).toEqual(source.size)
  expect(tree.y).toBe(70 - source.anchor[1])
})

test('integer enlargement fills volumes and preserves the shared ancient-tree material remap', () => {
  const world = compile_world_recipe(world_terrain('nauvis'))
  const palette = { swamp_wood: 'temperate_wood', swamp_foliage: 'temperate_foliage' }
  const tree = place_tree(world, 'adventure_ancient_tree', 100, 70, 100, 2, 1, palette)
  const single = place_tree(world, 'adventure_ancient_tree', 100, 70, 100, 1, 1, palette)
  expect(tree.type.packed_voxels.length).toBe(single.type.packed_voxels.length * 8)
  expect([...tree.type.size]).toEqual(single.type.size.map((size) => size * 2))
  const wood = world.materials.id_for('temperate_wood')
  const layers = new Set(
    [...tree.type.packed_voxels].filter((p) => p >>> 24 === wood).map((p) => tree.y + ((p >>> 16) & 255))
  )
  for (let y = 70; y < 100; y++) expect(layers.has(y)).toBe(true)
})

test('a tree base meets descending terrain across its footprint', () => {
  const base = compile_world_recipe(world_terrain('nauvis'), { city_terrain: false })
  const world = compile_world_recipe(
    {
      ...base.recipe,
      height_grid: {
        min_x: 64,
        min_z: 64,
        width: 10,
        depth: 10,
        cell_size: 8,
        target_heights: Array.from({ length: 100 }, (_, i) => 40 + (i % 10) * 3),
        cut_cells: [],
      },
    },
    { city_terrain: false }
  )
  const y = sample_world_column(world, 100, 100).surface_y
  const tree = place_tree(world, 'temperate_large_tree_g1', 100, y, 100, 2, 0)
  const feet = [...tree.type.packed_voxels].filter((p) => ((p >>> 16) & 255) === 0 && p >>> 24 !== 0)
  expect(feet.length).toBeGreaterThan(0)
  feet.forEach((p) => {
    const x = tree.x + (p & 255),
      z = tree.z + ((p >>> 8) & 255)
    expect(tree.y).toBeLessThanOrEqual(sample_world_column(world, x, z).surface_y)
  })
})

test('authored giant trees have broad trunks below their crowns', () => {
  const world = compile_world_recipe(world_terrain('nauvis'))
  const giants = thebes_source.trees.filter(({ scale }) => scale > 1)
  expect(giants.length).toBeGreaterThan(0)
  for (const { source } of giants) {
    const type = compile_type(source, {
      ...world.materials,
      id_for: (name) => world.materials.id_for((thebes_source.tree_materials as Record<string, string>)[name] ?? name),
    })
    const trunk_y = Math.floor(type.size[1] / 3)
    const trunk = [...type.packed_voxels].filter(
      (p) => ((p >>> 16) & 255) === trunk_y && world.materials.entries[p >>> 24]!.preset === 'bark'
    )
    expect(trunk.length).toBeGreaterThanOrEqual(9)
    expect(new Set(trunk.map((p) => p & 255)).size).toBeGreaterThanOrEqual(3)
    expect(new Set(trunk.map((p) => (p >>> 8) & 255)).size).toBeGreaterThanOrEqual(3)
  }
})
