// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { lantern_flicker, lantern_intensity } from '../src/lantern.ts'

describe('night lantern', () => {
  test('is off in daylight, full at night, smooth through dusk', () => {
    expect(lantern_intensity(0.5)).toBe(0)
    expect(lantern_intensity(0.04)).toBe(0)
    expect(lantern_intensity(-0.12)).toBe(1)
    expect(lantern_intensity(-0.5)).toBe(1)
    const dusk = lantern_intensity(-0.04)
    expect(dusk).toBeGreaterThan(0)
    expect(dusk).toBeLessThan(1)
    expect(lantern_intensity(-0.06)).toBeGreaterThan(dusk)
  })

  test('flicker breathes around 1 without strobing', () => {
    for (let now = 0; now < 10_000; now += 97) {
      const flicker = lantern_flicker(now)
      expect(flicker).toBeGreaterThan(0.88)
      expect(flicker).toBeLessThan(1.12)
    }
  })
})
