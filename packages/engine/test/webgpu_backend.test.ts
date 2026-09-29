// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { reflection_scale } from '../src/water_reflection.ts'
import { surface_is_drawable } from '../src/webgpu_backend.ts'

test('a sub-native canvas waits until every frame attachment has a physical pixel', () => {
  expect(surface_is_drawable(0, 800, 0.9, 0.82)).toBeFalse()
  expect(surface_is_drawable(1, 800, 0.9, 0.82)).toBeFalse()
  expect(surface_is_drawable(800, 1, 1, 0.4)).toBeFalse()
  expect(surface_is_drawable(800, 600, 0.9, 0.82)).toBeTrue()
})

test('an extremely short wide surface waits for its capped reflection to have a pixel', () => {
  const mirror = reflection_scale('high', 8192, 3)
  expect(Math.round(3 * mirror)).toBe(0)
  expect(surface_is_drawable(8192, 3, 1, 0.4)).toBe(true)
  expect(surface_is_drawable(8192, 3, 1, Math.min(0.4, mirror))).toBe(false)
})
