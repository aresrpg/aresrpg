// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { chunk_in_frustum } from '../src/chunk_visibility.ts'

const unit_box_planes = [
  { normal: { x: 1, y: 0, z: 0 }, constant: 1 },
  { normal: { x: -1, y: 0, z: 0 }, constant: 1 },
  { normal: { x: 0, y: 1, z: 0 }, constant: 1 },
  { normal: { x: 0, y: -1, z: 0 }, constant: 1 },
  { normal: { x: 0, y: 0, z: 1 }, constant: 1 },
  { normal: { x: 0, y: 0, z: -1 }, constant: 1 },
]

test('chunk frustum test keeps intersecting bounds and rejects wholly external layers', () => {
  expect(chunk_in_frustum([-0.5, -0.5, -0.5], 1, unit_box_planes)).toBeTrue()
  expect(chunk_in_frustum([1, -0.5, -0.5], 1, unit_box_planes)).toBeTrue()
  expect(chunk_in_frustum([1.01, -0.5, -0.5], 1, unit_box_planes)).toBeFalse()
  expect(chunk_in_frustum([-0.5, 2, -0.5], 1, unit_box_planes)).toBeFalse()
})
