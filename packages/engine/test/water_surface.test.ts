// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { shore_foam_profile, shore_wave_displacement } from '../src/water.ts'

describe('water surface detail', () => {
  test('foam is a shoreline band, not a tint over the whole ocean', () => {
    expect(shore_foam_profile(0)).toBe(0)
    expect(shore_foam_profile(0.45)).toBeGreaterThan(0.5)
    expect(shore_foam_profile(2)).toBe(0)
  })

  test('wave troughs cannot fall through the last shoreline block', () => {
    expect(shore_wave_displacement(-0.27, 0)).toBe(0)
    expect(shore_wave_displacement(-0.27, 0.65)).toBeGreaterThan(-0.27)
    expect(shore_wave_displacement(-0.27, 2)).toBe(-0.27)
    expect(shore_wave_displacement(0.27, 0)).toBe(0.27)
  })
})
