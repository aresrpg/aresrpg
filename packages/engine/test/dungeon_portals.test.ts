// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { portal_hum_gain } from '../src/dungeon_portals.ts'

test('dungeon portal hum fades smoothly and stops outside its ambience radius', () => {
  expect(portal_hum_gain(0)).toBeCloseTo(0.055)
  expect(portal_hum_gain(14)).toBeCloseTo(0.0275)
  expect(portal_hum_gain(28)).toBe(0)
  expect(portal_hum_gain(100)).toBe(0)
})
