// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { decode_detail_vertices, DETAIL_STRIDE } from '../../packages/engine/src/detail_artifact.ts'
import { bake_schematic } from '../bake_schematic.mjs'

test('missing references, cycles and unsupported operations fail at the bake boundary', () => {
  expect(() => bake_schematic({}, 'missing')).toThrow('Unknown schematic')
  const part = (asset) => ({ asset, position: [0, 0, 0], rotation: 0 })
  expect(() => bake_schematic({ a: { parts: [part('b')] }, b: { parts: [part('a')] } }, 'a')).toThrow(
    'Cyclic schematic'
  )
  expect(() => bake_schematic({ a: { details: [['constructor']] } }, 'a')).toThrow('Unknown schematic operation')
  expect(() => bake_schematic({ a: { voxels: [['finish']] } }, 'a')).toThrow('Legacy voxel operations')
  expect(() =>
    bake_schematic(
      { a: { parts: [{ ...part('b'), rotation: 4 }] }, b: { details: [['box', [0, 0, 0], [1, 1, 1], 'stone']] } },
      'a'
    )
  ).toThrow('Schematic rotation')
})

test('nested placement uses one transform for solid occupancy, detail geometry and plants', () => {
  const assets = {
    leaf: {
      pieces: [['block', [1, 2, 3], 'stone', 0, 'bottom']],
      details: [['box', [1, 2, 3], [2, 3, 4], 'stone']],
      plants: [{ kind: 'fern', center: [1, 2, 3] }],
      fires: [{ center: [1, 2, 3], scale: 1 }],
    },
    parent: { parts: [{ asset: 'leaf', position: [10, 4, 20], rotation: 1 }] },
    root: { parts: [{ asset: 'parent', position: [30, 0, 10], rotation: 3 }] },
  }
  const source = JSON.stringify(assets)
  const baked = bake_schematic(assets, 'root', [16, 32, 16])
  expect(baked.blocks).toEqual([[67, 38, 19, 'stone']])
  expect(baked.plants[0].center).toEqual([67, 38, 19])
  expect(baked.fires[0].center).toEqual([67, 38, 19])
  const positions = baked.details.flatMap((cell) => {
    const vertices = decode_detail_vertices(cell.vertices)
    return Array.from({ length: vertices.length / DETAIL_STRIDE }, (_, index) =>
      [0, 1, 2].map((axis) => vertices[index * DETAIL_STRIDE + axis] + cell.origin[axis])
    )
  })
  expect([0, 1, 2].map((axis) => Math.min(...positions.map((point) => point[axis])))).toEqual([67, 38, 19])
  expect([0, 1, 2].map((axis) => Math.max(...positions.map((point) => point[axis])))).toEqual([68, 39, 20])
  expect(JSON.stringify(assets)).toBe(source)
})
