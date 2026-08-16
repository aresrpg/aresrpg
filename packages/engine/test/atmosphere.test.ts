// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { fog_density } from '../src/atmosphere.ts'

describe('local volumetric atmosphere', () => {
  test('humidity raises density while altitude clears it', () => {
    expect(fog_density({ humidity: 0.9, height: 0, region: 1 })).toBeGreaterThan(
      fog_density({ humidity: 0.3, height: 0, region: 1 })
    )
    expect(fog_density({ humidity: 0.9, height: 30, region: 1 })).toBeLessThan(
      fog_density({ humidity: 0.9, height: 0, region: 1 })
    )
  })

  test('clear procedural regions carry no local fog', () => {
    expect(fog_density({ humidity: 1, height: 0, region: 0 })).toBe(0)
  })
})
