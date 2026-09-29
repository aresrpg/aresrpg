// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { building_kit, piece_cells } from '../building_kit.mjs'
import { bake_schematic } from '../bake_schematic.mjs'

test('only full blocks, half slabs and Minecraft-shaped stairs enter the architecture grid', () => {
  for (const [shape, count] of [
    ['block', 8],
    ['slab', 4],
    ['stair', 6],
    ['stair_inner', 7],
    ['stair_outer', 5],
  ])
    for (const rotation of [0, 1, 2, 3])
      for (const half of ['bottom', 'top']) {
        const cells = piece_cells([shape, [0, 0, 0], 'stone', rotation, half])
        expect(cells).toHaveLength(count)
        expect(new Set(cells.map((cell) => cell.slice(0, 3).join(','))).size).toBe(count)
        expect(cells.every((cell) => cell.slice(0, 3).every((n) => n === 0 || n === 1))).toBe(true)
      }
  expect(() => piece_cells(['beam', [0, 0, 0], 'stone', 0, 'bottom'])).toThrow('Unsupported')
  expect(() => piece_cells(['slab', [0.25, 0, 0], 'stone', 0, 'bottom'])).toThrow('integer')
  expect(() => piece_cells(['stair', [0, 0, 0], 'stone', 4])).toThrow('quarter')
})

test('overlapping architectural volumes fail while touching and complementary slabs are legal', () => {
  const kit = building_kit()
  const identity = (point) => point
  kit.add(['slab', [0, 0, 0], 'stone', 0, 'bottom'], identity, 'floor')
  expect(() => kit.add(['block', [0, 0, 0], 'wood', 0, 'bottom'], identity, 'wall')).toThrow('Overlapping')
  const other = building_kit()
  other.add(['slab', [0, 0, 0], 'stone', 0, 'bottom'], identity, 'bottom')
  other.add(['slab', [0, 0, 0], 'stone', 0, 'top'], identity, 'top')
  other.add(['slab', [1, 0, 0], 'stone', 0, 'bottom'], identity, 'next')
})

test('adjacent slabs remove shared faces and merge coplanar surfaces with outward winding', () => {
  const kit = building_kit()
  for (const x of [0, 1, 2]) kit.add(['slab', [x, 0, 0], 'stone', 0, 'bottom'], (point) => point, 'roof')
  const quads = []
  kit.finish({ quad: (...args) => quads.push(args) })
  expect(quads).toHaveLength(6)
  for (const [a, b, c] of quads) {
    const u = b.map((v, i) => v - a[i]),
      v = c.map((n, i) => n - a[i])
    const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    const center = a.map((n, i) => (n + b[i] + c[i]) / 3 - [1.5, 0.25, 0.5][i])
    expect(normal.reduce((sum, n, i) => sum + n * center[i], 0)).toBeGreaterThan(0)
  }
})

test('partial blocks use the same world-aligned texture coordinates as full voxels', () => {
  const kit = building_kit()
  kit.add(['stair', [12, 3, 5], 'stone', 1, 'bottom'], (point) => point, 'stairs')
  const quads = []
  kit.finish({ quad: (...args) => quads.push(args) })
  for (const [a, b, c, d, , texture_coordinates] of quads) {
    const axis = [0, 1, 2].find((i) => a[i] === b[i] && b[i] === c[i] && c[i] === d[i])
    expect(texture_coordinates).toEqual(
      [a, b, c, d].map((point) => [point[axis === 0 ? 1 : 0] / 4, -point[axis === 2 ? 1 : 2] / 4])
    )
  }
})

test('building parts cannot hide arbitrary geometry or overlap through nested placements', () => {
  const block = { kind: 'building', pieces: [['block', [0, 0, 0], 'stone', 0, 'bottom']] }
  const parts = [0, 0].map(() => ({ asset: 'block', position: [0, 0, 0], rotation: 0 }))
  expect(() => bake_schematic({ house: { kind: 'building', parts }, block }, 'house')).toThrow('Overlapping')
  expect(() => bake_schematic({ house: { kind: 'building', details: [] } }, 'house')).toThrow('only block')
  expect(() =>
    bake_schematic(
      {
        house: { kind: 'building', parts: [{ asset: 'custom', position: [0, 0, 0], rotation: 0 }] },
        custom: { details: [] },
      },
      'house'
    )
  ).toThrow('Unapproved')
})
