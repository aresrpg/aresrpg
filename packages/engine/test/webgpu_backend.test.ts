// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { surface_is_drawable } from '../src/webgpu_backend.ts'

test('a sub-native canvas waits until every frame attachment has a physical pixel', () => {
  expect(surface_is_drawable(0, 800, 0.9, 0.82)).toBeFalse()
  expect(surface_is_drawable(1, 800, 0.9, 0.82)).toBeFalse()
  expect(surface_is_drawable(800, 1, 1, 0.4)).toBeFalse()
  expect(surface_is_drawable(800, 600, 0.9, 0.82)).toBeTrue()
})
