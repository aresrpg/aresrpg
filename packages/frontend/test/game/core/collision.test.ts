// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { box_overlaps_solid, resolve_movement, type SolidFn } from '../../../src/game/core/collision.ts'

test('landing on a known voxel face does not repeatedly search the same contact', () => {
  let reads = 0
  const result = resolve_movement(
    (_x, y) => {
      reads++
      return y < 0
    },
    [0.5, 0.1, 0.5],
    [0, -1, 0],
    0.2
  )
  expect(result.on_ground).toBe(true)
  expect(result.position[1]).toBeCloseTo(0, 2)
  expect(reads).toBeLessThanOrEqual(4)
})

const contacts = ([0, 1, 2] as const).flatMap((axis) =>
  [-1, 1].flatMap((sign) => [-20, 0, 20].map((offset) => ({ axis, sign, offset })))
)

test.each(contacts)('voxel contact at axis $axis, direction $sign, offset $offset', ({ axis, sign, offset }) => {
  const position: [number, number, number] = [offset + 0.5, offset + 0.1, offset + 0.5]
  const velocity: [number, number, number] = [0, 0, 0]
  velocity[axis] = sign * 20
  const wall = sign > 0 ? offset + 3 : offset - 2
  const solid: SolidFn = (...point) => (sign > 0 ? point[axis] >= wall : point[axis] < wall)
  const result = resolve_movement(solid, position, velocity, 0.5)
  expect(box_overlaps_solid(solid, ...result.position, 0.4, 1.9)).toBe(false)
  const extent = axis === 1 ? (sign > 0 ? 1.9 : 0) : 0.4
  expect(result.position[axis]).toBeCloseTo(wall - sign * extent, 2)
  expect(result.velocity[axis]).toBe(0)
})

test('a body already inside terrain cannot gain movement from another blocked contact', () => {
  const solid: SolidFn = (x) => x >= 0 && x < 4
  const position = [1.59, 0, 0.5] as const
  const result = resolve_movement(solid, position, [2, 0, 0], 0.1)
  expect(result.position).toEqual([...position])
})
