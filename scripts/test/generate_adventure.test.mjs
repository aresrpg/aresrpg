// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { pack_adventure_scene } from '../generate_adventure.mjs'
import { encode_voxel_runs } from '../encode_voxel_runs.mjs'

test('the existing run format keeps gaps and palette changes in sorted cell order', () => {
  const encoded = encode_voxel_runs([
    [4, 2],
    [1, 0],
    [2, 0],
    [3, 1],
  ])
  expect([...Buffer.from(encoded, 'base64')]).toEqual([1, 0, 2, 0, 0, 3, 0, 1, 0, 1, 4, 0, 1, 0, 2])
  expect(() => encode_voxel_runs([[65536, 0]])).toThrow()
  expect(() => encode_voxel_runs([[0, 256]])).toThrow()
})

const placement = {
  source: {
    name: 'route',
    size: [64, 64, 64],
    anchor: [0, 0, 0],
    blocks: [
      [31, 31, 31, 'stone'],
      [32, 32, 32, 'air'],
    ],
  },
  origin: [96, 0, 96],
  rotation: 0,
}

test('packing retains explicit air, world origins, and named-placement order across all three cell boundaries', () => {
  const tree = { source: 'tree', origin: [0, 0, 0], rotation: 1 }
  const result = pack_adventure_scene({ world: { fixed_structures: [tree, placement] }, resources: [] })
  expect(result.scene.world.fixed_structures).toEqual([
    tree,
    { source: 'adventure_scene_route_0_0_0', origin: [96, 0, 96], rotation: 0 },
    { source: 'adventure_scene_route_32_32_32', origin: [128, 32, 128], rotation: 0 },
  ])
  const [stone, air] = Object.values(result.types)
  expect(stone.palette).toEqual(['stone'])
  expect(air.palette).toEqual(['air'])
  expect([...Buffer.from(stone.runs, 'base64')]).toEqual([255, 127, 1, 0, 0])
  expect([...Buffer.from(air.runs, 'base64')]).toEqual([0, 0, 1, 0, 0])
})

test('packing refuses unsupported transforms and voxels outside their authored source', () => {
  const pack = (row) => pack_adventure_scene({ world: { fixed_structures: [row] }, resources: [] })
  expect(() => pack({ ...placement, rotation: 1 })).toThrow('unrotated')
  expect(() => pack({ ...placement, scale: 2 })).toThrow('unscaled')
  expect(() => pack({ ...placement, source: { ...placement.source, anchor: [1, 0, 0] } })).toThrow('origin-anchored')
  expect(() => pack({ ...placement, source: { ...placement.source, blocks: [[64, 0, 0, 'stone']] } })).toThrow(
    'out-of-bounds'
  )
  expect(() => pack_adventure_scene({ world: { fixed_structures: [placement, placement] } })).toThrow('Duplicate')
})
