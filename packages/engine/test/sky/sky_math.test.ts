// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { derive_night_sky_params, horizon_fade_js, night_gate_js } from '../../src/sky/night_sky.ts'
import { disc_space_uv_js, luminance, palette_for_sun } from '../../src/sky/sky_node.ts'

describe('sky reference math', () => {
  test('night fades in gradually and horizon extinction remains smooth', () => {
    expect(night_gate_js(0)).toBe(0)
    expect(night_gate_js(-0.2)).toBe(1)
    expect(night_gate_js(-0.08)).toBeGreaterThan(0)
    expect(night_gate_js(-0.08)).toBeLessThan(1)
    expect(horizon_fade_js(0, { start_deg: 14, end_deg: 0 })).toBe(0)
    expect(horizon_fade_js(Math.sin((14 * Math.PI) / 180), { start_deg: 14, end_deg: 0 })).toBe(1)
  })

  test('seeded galaxies are deterministic unit frames', () => {
    const first = derive_night_sky_params('first-shore')
    const second = derive_night_sky_params('first-shore')
    expect(first).toEqual(second)
    expect(Math.hypot(...first.galaxy_n)).toBeCloseTo(1, 12)
    expect(
      first.galaxy_n[0] * first.galaxy_a[0] +
        first.galaxy_n[1] * first.galaxy_a[1] +
        first.galaxy_n[2] * first.galaxy_a[2]
    ).toBeCloseTo(0, 12)
  })

  test('disc coordinates and daylight palette retain their visual invariants', () => {
    expect(disc_space_uv_js([0, 0, 1], [0, 0, 1])).toEqual([0, 0])
    const night = palette_for_sun(-1)
    const day = palette_for_sun(1)
    expect(luminance(day.horizon)).toBeGreaterThan(luminance(night.horizon))
  })
})
