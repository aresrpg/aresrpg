// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { build_obstacle_rocks } from '../src/fight_board_rocks.ts'

const build = (cells: readonly { x: number; y: number }[]) =>
  build_obstacle_rocks({ cells, cell_size: 1.33, origin: { x: 0, z: 0 }, floor_y: 0.3 })

test('the same obstacle layout always grows the identical formation', () => {
  const first = build([
    { x: 2, y: 3 },
    { x: 3, y: 3 },
  ])
  const second = build([
    { x: 2, y: 3 },
    { x: 3, y: 3 },
  ])
  expect([...(second.getAttribute('position').array as Float32Array)]).toEqual([
    ...(first.getAttribute('position').array as Float32Array),
  ])
})

test('adjacent obstacle cells fuse: the pair carries bridge stones a gapped pair lacks', () => {
  const count = (geometry: ReturnType<typeof build>) => geometry.getAttribute('position').count
  const adjacent = build([
    { x: 0, y: 0 },
    { x: 1, y: 0 },
  ])
  const gapped = build([
    { x: 0, y: 0 },
    { x: 2, y: 0 },
  ])
  expect(count(adjacent)).toBeGreaterThan(count(gapped))
  // the bridge stone stands across the shared edge (x = cell_size), covering both sides
  const positions = adjacent.getAttribute('position')
  const spans_edge = Array.from({ length: positions.count }, (_, index) => positions.getX(index)).some(
    (x) => Math.abs(x - 1.33) < 0.2
  )
  expect(spans_edge).toBeTrue()
})

test('stones bed into the slab with a clamped base and never sink through it', () => {
  const geometry = build([{ x: 0, y: 0 }])
  const positions = geometry.getAttribute('position')
  const ys = Array.from({ length: positions.count }, (_, index) => positions.getY(index))
  expect(Math.min(...ys)).toBeGreaterThanOrEqual(0.3 - 0.05)
  expect(Math.max(...ys)).toBeGreaterThan(0.3)
})

test('the whole formation wears ONE color — every vertex is a shade of the same tone', () => {
  const geometry = build([
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 5, y: 5 },
  ])
  const colors = geometry.getAttribute('color')
  const ratios = new Set<string>()
  for (let index = 0; index < colors.count; index += 1) {
    const red = colors.getX(index)
    const blue = colors.getZ(index)
    ratios.add((red / blue).toFixed(3))
  }
  expect(ratios.size).toBe(1)
})

test('an empty obstacle set builds an empty geometry without erroring', () => {
  expect(build([]).getAttribute('position')).toBeUndefined()
})
