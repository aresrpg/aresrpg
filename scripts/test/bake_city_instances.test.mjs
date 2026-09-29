// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { compile_world_recipe, sample_world_column } from '../../packages/engine/src/world_recipe.ts'
import { world_terrain } from '../../packages/engine/src/world_catalog.ts'
import { bake_city_instances } from '../bake_city_instances.mjs'
import { partition_blocks } from '../partition_blocks.mjs'

const assets = { pillar: { kind: 'building', pieces: [['block', [0, 0, 0], 'stone', 0, 'bottom']] } }
const instance = { asset: 'pillar', position: [0, 0, 0], rotation: 0, scale: 3, buried: 0.5 }

test('scaled buried landmarks contain filled volumes across negative chunk boundaries', () => {
  const world = compile_world_recipe(world_terrain('nauvis'), { city_terrain: false })
  const blocks = bake_city_instances(world, assets, [-33, -33], [instance])
  const ground = sample_world_column(world, -33, -33).surface_y
  expect(blocks).toHaveLength(27)
  expect(new Set(blocks.map(([x, y, z]) => [x, y, z].join(','))).size).toBe(27)
  expect(Math.min(...blocks.map(([, y]) => y))).toBe(ground - 2)
  const unpacked = partition_blocks(blocks).flatMap(({ origin, blocks: local }) =>
    local.map(([x, y, z, material]) => [x + origin[0], y + origin[1], z + origin[2], material])
  )
  expect(new Set(unpacked.map(JSON.stringify))).toEqual(new Set(blocks.map(JSON.stringify)))
})

test('scaled landmarks reject partial blocks and invalid burial instead of producing detached geometry', () => {
  const world = compile_world_recipe(world_terrain('nauvis'), { city_terrain: false })
  for (const change of [{ scale: 1.5 }, { scale: 0 }, { buried: NaN }, { buried: -1 }, { buried: 2 }])
    expect(() => bake_city_instances(world, assets, [0, 0], [{ ...instance, ...change }])).toThrow('Invalid landmark')
  const partial = { pillar: { kind: 'building', pieces: [['slab', [0, 0, 0], 'stone', 0, 'bottom']] } }
  expect(() => bake_city_instances(world, partial, [0, 0], [instance])).toThrow('solid voxel templates')
})

test('voxel partitioning resolves excavation before masonry with one operation per cell', () => {
  const cells = partition_blocks([
    [-33, 12, -33, 'air'],
    [-33, 12, -33, 'stone'],
    [-32, 12, -33, 'air'],
  ])
  const blocks = cells.flatMap(({ blocks }) => blocks)
  expect(blocks).toHaveLength(2)
  expect(blocks.map(([, , , material]) => material)).toEqual(['stone', 'air'])
})
