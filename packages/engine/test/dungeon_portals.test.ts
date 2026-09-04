// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { DUNGEON_PORTAL_LABEL_HEIGHT, DUNGEON_PORTAL_ROOT_HEIGHT, portal_hum_gain } from '../src/dungeon_portals.ts'

test('the dungeon portal root stands two blocks above its former placement', () => {
  expect(DUNGEON_PORTAL_ROOT_HEIGHT).toBeCloseTo(3.36)
})

test('the dungeon tag sits three blocks below its former crown clearance', () => {
  expect(DUNGEON_PORTAL_LABEL_HEIGHT).toBeCloseTo(5.66)
})

test('dungeon portal hum fades smoothly and stops outside its ambience radius', () => {
  expect(portal_hum_gain(0)).toBeCloseTo(0.055)
  expect(portal_hum_gain(14)).toBeCloseTo(0.0275)
  expect(portal_hum_gain(28)).toBe(0)
  expect(portal_hum_gain(100)).toBe(0)
  expect(portal_hum_gain(0, 0.25)).toBeCloseTo(0.01375)
})
