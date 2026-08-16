// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { UNDERWATER, is_submerged } from '../src/underwater.ts'

test('the eye submerges past the band and surfaces past the band', () => {
  expect(is_submerged(-0.5, 0, false)).toBeTrue()
  expect(is_submerged(0.5, 0, true)).toBeFalse()
})

test('the dead-band across the waterline holds the previous state (no flicker)', () => {
  const grazing = UNDERWATER.hysteresis_m / 2
  expect(is_submerged(-grazing, 0, false)).toBeFalse()
  expect(is_submerged(grazing, 0, true)).toBeTrue()
})

test('no water over the eye is a hard exit, whatever the previous state', () => {
  expect(is_submerged(-10, null, true)).toBeFalse()
})
