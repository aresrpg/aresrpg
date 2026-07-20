// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import {
  EARTH_ATMOSPHERE,
  SKY_TIERS,
  merge_atmosphere_params,
  ozone_density,
  resolve_sky_tier,
} from './atmosphere_params.js'

describe('atmosphere params — Earth defaults + per-world tie-in', () => {
  test('Earth coefficients are the paper values converted to per-km (×1e3 from per-metre)', () => {
    // paper: Rayleigh σs 5.802/13.558/33.1e-6 /m ⇒ e-3 /km.
    expect(EARTH_ATMOSPHERE.rayleigh_scattering).toEqual([5.802e-3, 13.558e-3, 33.1e-3])
    expect(EARTH_ATMOSPHERE.mie_scattering).toBeCloseTo(3.996e-3, 9)
    expect(EARTH_ATMOSPHERE.mie_absorption).toBeCloseTo(4.4e-3, 9)
    expect(EARTH_ATMOSPHERE.mie_g).toBe(0.8)
    expect(EARTH_ATMOSPHERE.ground_radius_km).toBe(6360)
    expect(EARTH_ATMOSPHERE.top_radius_km).toBe(6460)
    expect(EARTH_ATMOSPHERE.ozone_center_km).toBe(25)
    expect(EARTH_ATMOSPHERE.ozone_width_km).toBe(15)
  })

  test('the canon set is frozen (callers cannot mutate the shared default)', () => {
    expect(Object.isFrozen(EARTH_ATMOSPHERE)).toBe(true)
  })

  test('merge overrides fields without mutating the base (mood crossfade / Mars-class sets)', () => {
    const mars = merge_atmosphere_params(EARTH_ATMOSPHERE, { rayleigh_scattering: [10e-3, 6e-3, 3e-3], exposure: 12 })
    expect(mars.rayleigh_scattering).toEqual([10e-3, 6e-3, 3e-3])
    expect(mars.exposure).toBe(12)
    expect(mars.mie_g).toBe(EARTH_ATMOSPHERE.mie_g) // untouched fields carry through
    expect(EARTH_ATMOSPHERE.rayleigh_scattering).toEqual([5.802e-3, 13.558e-3, 33.1e-3]) // base intact
  })
})

describe('ozone tent — the horizon-blue term shape', () => {
  test('peaks at the centre, zero at ±width, clamped non-negative beyond', () => {
    expect(ozone_density(25, 25, 15)).toBe(1)
    expect(ozone_density(10, 25, 15)).toBeCloseTo(0, 9)
    expect(ozone_density(40, 25, 15)).toBeCloseTo(0, 9)
    expect(ozone_density(0, 25, 15)).toBe(0) // clamped, never negative
    expect(ozone_density(17.5, 25, 15)).toBeCloseTo(0.5, 6)
  })
})

describe('tier ladder — paper HIGH, Fortnite-mobile MEDIUM, per-frame-skippable LOW', () => {
  test('HIGH is the paper resolutions', () => {
    const t = SKY_TIERS.high
    expect([t.transmittance_w, t.transmittance_h]).toEqual([256, 64])
    expect(t.multiscatter_res).toBe(32)
    expect([t.skyview_w, t.skyview_h]).toEqual([200, 100])
    expect([t.aerial_res, t.aerial_slices]).toEqual([32, 32])
    expect(t.rebuild_on_sun_only).toBe(false)
  })

  test('MEDIUM is the Fortnite ship config (sky-view 96×50@8, aerial 32²×16)', () => {
    const t = SKY_TIERS.medium
    expect([t.skyview_w, t.skyview_h, t.skyview_steps]).toEqual([96, 50, 8])
    expect([t.aerial_res, t.aerial_slices]).toEqual([32, 16])
  })

  test('LOW rebuilds the view LUTs only on a sun-angle change', () => {
    expect(SKY_TIERS.low.rebuild_on_sun_only).toBe(true)
  })

  test('resolve accepts a name or an explicit tier object; defaults to HIGH', () => {
    expect(resolve_sky_tier('medium')).toBe(SKY_TIERS.medium)
    expect(resolve_sky_tier()).toBe(SKY_TIERS.high)
    expect(resolve_sky_tier(/** @type {any} */ ('bogus'))).toBe(SKY_TIERS.high)
    const custom = SKY_TIERS.high
    expect(resolve_sky_tier(custom)).toBe(custom)
  })
})
