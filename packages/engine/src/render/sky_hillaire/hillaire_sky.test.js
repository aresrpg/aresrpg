// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// C9 Hillaire sky lifecycle — the same disposed-subsystem-unreachable-from-the-ticker law clouds.test.js
// pins (the logout crash class), plus the LUT rebuild policy (param LUTs on set_atmosphere_params, view
// LUTs per frame / on sun-change at LOW) and the flag-consumer nodes building CPU-side. Fake renderer:
// the TSL kernels build CPU-side; only compute submission is faked (no WebGPU needed).

import { describe, expect, test } from 'bun:test'

import { sun_transmittance, luminance } from '../lighting/sky_light_coupling.js'
import {
  moon_halo_js,
  moon_sky_glow_js,
  MOON_HORIZON_LIFT,
  MOON_SKY_GLOW,
  MOON_SKY_GLOW_RGB,
} from '../sky/night_sky.js'
import { MOON_DISC_RGB, SKY_NIGHT, sun_dir_from_tod } from '../sky/sky_node.js'

import { EARTH_ATMOSPHERE } from './atmosphere_params.js'
import {
  create_hillaire_sky,
  MOON_DISC_RADIANCE,
  SUN_DISC_RADIANCE,
  SUN_GLARE_VIS,
  SUN_GLARE_GAIN,
  SUN_MIE_POW,
  SUN_MIE_GAIN,
} from './hillaire_sky.js'

/** Records every compute submission — the surface bake/tick drive. @returns {*} */
function fake_renderer() {
  /** @type {string[]} */
  const calls = []
  return {
    calls,
    computeAsync: async (/** @type {*} */ k) => {
      calls.push(k?.name ?? '?')
    },
    compute: (/** @type {*} */ k) => {
      calls.push(k?.name ?? '?')
    },
  }
}

/** Identity-posed fake camera (right=+x, up=+y, fwd=−z) at altitude `y`. @param {number} y */
function fake_camera(y = 200) {
  return {
    position: { x: 0, y, z: 0 },
    matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
    fov: 70,
    aspect: 16 / 9,
  }
}

describe('hillaire sky — construction + consumer nodes', () => {
  test('builds the background, fog, and sample_sky nodes CPU-side without a GPU', () => {
    const sky = create_hillaire_sky({ tier: 'high' })
    expect(sky.background_node).toBeTruthy()
    expect(sky.fog_node).toBeTruthy()
    expect(sky.sample_sky).toBeInstanceOf(Function)
    expect(sky.tier.skyview_w).toBe(200)
    // sample_sky returns a node (does not throw).
    expect(sky.sample_sky(sky.sun_direction)).toBeTruthy()
  })

  test('set_atmosphere_params writes the live uniforms (Mars-class retune)', () => {
    const sky = create_hillaire_sky({ tier: 'medium' })
    sky.set_atmosphere_params({ exposure: 42, rayleigh_scattering: [1e-3, 2e-3, 3e-3] })
    expect(sky.U.exposure.value).toBe(42)
    expect([
      sky.U.rayleigh_scattering.value.x,
      sky.U.rayleigh_scattering.value.y,
      sky.U.rayleigh_scattering.value.z,
    ]).toEqual([1e-3, 2e-3, 3e-3])
  })
})

describe('hillaire sky — LUT rebuild policy', () => {
  test('bake computes all four LUTs in dependency order', async () => {
    const sky = create_hillaire_sky({ tier: 'high' })
    const r = fake_renderer()
    await sky.bake(r)
    expect(r.calls).toEqual(['hillaireTransmittance', 'hillaireMultiScatter', 'hillaireSkyView', 'hillaireAerial'])
  })

  test('the first tick rebuilds the view LUTs; an unchanged tick IDLES (no per-frame storm)', async () => {
    const sky = create_hillaire_sky({ tier: 'high' })
    const r = fake_renderer()
    await sky.bake(r)
    r.calls.length = 0
    sky.tick(r, fake_camera(), 0.016) // first tick: inputs "moved" from init → rebuild
    expect(r.calls).toEqual(['hillaireSkyView', 'hillaireAerial']) // view LUTs only (not the param LUTs)
    r.calls.length = 0
    sky.tick(r, fake_camera(), 0.016) // identical pose + sun → nothing to recompute
    expect(r.calls).toEqual([])
  })

  test('a camera ROTATION rebuilds only the aerial (frustum volume); sky-view holds', async () => {
    const sky = create_hillaire_sky({ tier: 'high' })
    const r = fake_renderer()
    await sky.bake(r)
    sky.tick(r, fake_camera(), 0.016) // establish baseline
    r.calls.length = 0
    const rotated = fake_camera()
    rotated.matrixWorld.elements = [0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1] // yaw 90° → fwd changes
    sky.tick(r, rotated, 0.016)
    expect(r.calls).toEqual(['hillaireAerial']) // aerial only — sun + altitude unchanged
  })

  test('the rotation switch suppresses only orientation-triggered aerial rebuilds', async () => {
    let aerial_dispatches = 0
    const sky = create_hillaire_sky({
      tier: 'high',
      rebuild_on_rotate: false,
      on_aerial_dispatch: () => {
        aerial_dispatches += 1
      },
    })
    const r = fake_renderer()
    await sky.bake(r)
    sky.tick(r, fake_camera(), 0.016)
    r.calls.length = 0
    aerial_dispatches = 0
    const rotated = fake_camera()
    rotated.matrixWorld.elements = [0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1]
    sky.tick(r, rotated, 0.016)
    expect(r.calls).toEqual([])
    expect(aerial_dispatches).toBe(0)

    sky.sun_direction.value.set(0.9, 0.1, 0.2).normalize()
    sky.tick(r, rotated, 0.016)
    expect(r.calls).toEqual(['hillaireSkyView', 'hillaireAerial'])
    expect(aerial_dispatches).toBe(1)
  })

  test('set_atmosphere_params triggers a one-shot transmittance + multiscatter rebuild next tick', async () => {
    const sky = create_hillaire_sky({ tier: 'high' })
    const r = fake_renderer()
    await sky.bake(r)
    sky.tick(r, fake_camera(), 0.016) // establish baseline (so the param tick isn't also a first-frame rebuild)
    sky.set_atmosphere_params({ mie_g: 0.75 })
    r.calls.length = 0
    sky.tick(r, fake_camera(), 0.016)
    expect(r.calls).toEqual(['hillaireTransmittance', 'hillaireMultiScatter', 'hillaireSkyView', 'hillaireAerial'])
    // param LUTs do NOT rebuild again on a plain sun move — only the view LUTs do.
    sky.sun_direction.value.set(0.9, 0.1, 0.2).normalize()
    r.calls.length = 0
    sky.tick(r, fake_camera(), 0.016)
    expect(r.calls).toEqual(['hillaireSkyView', 'hillaireAerial'])
  })

  test('LOW rebuilds the view LUTs ONLY when the sun moves (per-frame-skippable; aerial ignores rotation)', async () => {
    const sky = create_hillaire_sky({ tier: 'low' })
    const r = fake_renderer()
    await sky.bake(r)
    sky.tick(r, fake_camera(), 0.016) // first tick establishes baseline
    r.calls.length = 0
    sky.tick(r, fake_camera(), 0.016) // sun unchanged → skip
    expect(r.calls).toEqual([])
    // a rotation does NOT rebuild the aerial on LOW (mobile floor).
    const rotated = fake_camera()
    rotated.matrixWorld.elements = [0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1]
    sky.tick(r, rotated, 0.016)
    expect(r.calls).toEqual([])
    // move the sun → one rebuild of both view LUTs.
    sky.sun_direction.value.set(0.9, 0.1, 0.2).normalize()
    sky.tick(r, fake_camera(), 0.016)
    expect(r.calls).toEqual(['hillaireSkyView', 'hillaireAerial'])
  })
})

describe('hillaire sky — two-phase dispose (the logout-crash law)', () => {
  test('tick is LIVE before dispose, INERT + throw-free after; textures freed', async () => {
    const sky = create_hillaire_sky({ tier: 'high' })
    const r = fake_renderer()
    await sky.bake(r)

    r.calls.length = 0
    sky.tick(r, fake_camera(), 0.016)
    expect(r.calls.length).toBeGreaterThan(0) // the path we must neutralize is genuinely active

    const freed = new Set()
    for (const name of ['transmittance', 'multiscatter', 'skyview', 'aerial'])
      sky.luts[name].addEventListener('dispose', () => freed.add(name))

    sky.dispose() // == logout teardown

    r.calls.length = 0
    expect(() => sky.tick(r, fake_camera(), 0.016)).not.toThrow() // inert, no throw
    expect(r.calls).toEqual([]) // zero GPU submissions on a disposed sky
    expect(freed).toEqual(new Set(['transmittance', 'multiscatter', 'skyview', 'aerial']))
  })
})

// 2026-07-12: the moon needed real surface texture and light rays instead of a flat circle, and the sun
// needed to read as a blinding light source rather than a flat disc. Pure-JS mirrors of the exact TSL
// formulas below (own math, not GPU-dependent) — the moon's a hard luminance ceiling, the sun's a shape
// proof (boundary-free, reshaped not doubled).
describe('moon — luminance cap (disc + FULL night-sky stack must never cross the 2.05 bloom knee)', () => {
  test('worst case (brightest texel at centre + halo peak + sky-glow at max horizon lift + night base) stays well under', () => {
    // disc: 2026-07-13 the maria SHAPE is now a real photographic texture (moon_texture(), sky_node.js),
    // sampled via TSL texture() — an SDR 8-bit asset is hard-bounded to 1.0 per channel by construction (no
    // texel can exceed it, regardless of which photo ships as moon.png), so 1.0 is the structural worst-case
    // surface multiplier — a STRICTER ceiling than the old fractal-noise peak (moon_surface_mul_js(1)=1.1;
    // the texture path has no rim-bright bonus term at all).
    const MOON_TEXTURE_PEAK = 1.0
    const disc = luminance(MOON_DISC_RGB) * MOON_DISC_RADIANCE * MOON_TEXTURE_PEAK
    // night_sky.js terms at the disc centre (cos=1): boundary-free halo peak + sky glow at max horizon lift
    // + the night base's brightest stop. Stars/planets/milky-way are OCCLUDED by the disc (moon_occ) so
    // they can never stack here — this IS the whole-stack worst case.
    const halo = luminance(MOON_DISC_RGB) * moon_halo_js(1)
    const glow = luminance(MOON_SKY_GLOW_RGB) * MOON_SKY_GLOW * moon_sky_glow_js(1) * (1 + MOON_HORIZON_LIFT)
    const base = luminance(SKY_NIGHT.horizon)
    const lum = disc + halo + glow + base
    expect(lum).toBeLessThan(2.05) // the hard bloom-knee constraint
    expect(lum).toBeLessThan(1.95) // "WELL under" — real headroom, not a razor's edge
  })
})

describe('sun glare — boundary-free (a blinding source of light, not a soccer ball)', () => {
  /** pure-JS mirror of the TSL glare_spike + mie_tail sum (hillaire_sky.js), θ in degrees from the sun. */
  const glare_shape = (deg) => {
    const v = Math.max(0, Math.min(1, Math.cos((deg * Math.PI) / 180)))
    const v4 = v * v * v * v
    const spike = SUN_GLARE_VIS / (1 - (1 - SUN_GLARE_VIS) * v4) - SUN_GLARE_VIS
    const mie = v ** SUN_MIE_POW
    return spike * SUN_GLARE_GAIN + mie * SUN_MIE_GAIN
  }

  test('monotonically non-increasing away from the sun — no bump, no discontinuity anywhere', () => {
    let prev = Infinity
    for (let deg = 0; deg <= 90; deg += 0.5) {
      const v = glare_shape(deg)
      expect(v).toBeLessThanOrEqual(prev + 1e-9)
      prev = v
    }
  })

  test('stays visibly present WAY past the OLD hard 5.7° window (the boundary-free proof)', () => {
    expect(glare_shape(20)).toBeGreaterThan(0.01)
    expect(glare_shape(35)).toBeGreaterThan(0) // still nonzero — the old windowed corona was EXACTLY 0 past 5.7°
  })

  test('fades below perception by ~80° — a genuine long tail, never a sky-wide wash', () => {
    expect(glare_shape(80)).toBeLessThan(0.01)
  })

  test('combined disc+halo peak at noon lands in the same ballpark as the OLD corona — reshaped, not doubled', () => {
    const noon_sun = sun_dir_from_tod(0.375)
    const T = sun_transmittance(noon_sun.y)
    const { exposure, sun_illuminance } = EARTH_ATMOSPHERE
    const sun_base = [
      sun_illuminance[0] * T[0] * exposure,
      sun_illuminance[1] * T[1] * exposure,
      sun_illuminance[2] * T[2] * exposure,
    ]
    const L = luminance(sun_base)
    const OLD_CORONA_GAIN = 2.8 // the retired windowed-corona peak gain — the "not doubled" baseline
    const old_peak = L * (SUN_DISC_RADIANCE + OLD_CORONA_GAIN)
    const new_peak = L * (SUN_DISC_RADIANCE + glare_shape(0))
    expect(new_peak).toBeGreaterThan(old_peak) // genuinely more present than the retired corona
    expect(new_peak).toBeLessThan(old_peak * 1.5) // but not doubled
  })
})
