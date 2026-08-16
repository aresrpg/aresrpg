// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import {
  CELESTIAL_CYCLE_MS,
  celestial_tod_at,
  moon_dir_from_tod,
  sun_dir_from_tod,
} from '../../src/sky/celestial_motion.ts'

describe('celestial motion', () => {
  test('the configured clock closes after one twenty-minute orbit', () => {
    expect(celestial_tod_at(CELESTIAL_CYCLE_MS, 0.31)).toBeCloseTo(0.31, 12)
  })

  test('the moon remains exactly antipodal to the sun', () => {
    for (const time of [0, 0.125, 0.5, 0.875]) {
      const sun = sun_dir_from_tod(time)
      const moon = moon_dir_from_tod(time)
      expect(sun.length()).toBeCloseTo(1, 12)
      expect(moon.x).toBeCloseTo(-sun.x, 12)
      expect(moon.y).toBeCloseTo(-sun.y, 12)
      expect(moon.z).toBeCloseTo(-sun.z, 12)
    }
  })
})
