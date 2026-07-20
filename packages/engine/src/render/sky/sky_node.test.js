// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure-math tests for the NG2-A analytic sky reference (`sample_sky_rgb`) and the tod→sun mapping.
// GPU/TSL behavior is the wiring wave's concern; these pin the shipped color MATH the TSL mirrors:
// halo monotonicity across sun angles, day>night brightness, the dusk warmth ramp, and that the sun
// arc is a unit vector above the horizon for exactly DAY_FRAC of the cycle.

import { test, expect, describe } from 'bun:test'

import {
  DAY_FRAC,
  SKY_DAY,
  SKY_DUSK,
  create_sky_node,
  disc_space_uv_js,
  luminance,
  palette_for_sun,
  sample_sky_rgb,
  sun_dir_from_tod,
  sun_tint_for,
} from './sky_node.js'

/** @param {[number,number,number]} v @returns {[number,number,number]} */
const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

const DAY_SUN = norm([0, 0.6, 0.8]) // sun well above the horizon
const NIGHT_SUN = norm([0, -0.4, 0.9]) // sun below the horizon

describe('sample_sky_rgb — sun-angle monotonicity', () => {
  test('horizon sweep away from the sun is non-increasing in luminance (the halo)', () => {
    let prev = Infinity
    for (let a = 0; a <= Math.PI + 1e-9; a += Math.PI / 24) {
      // horizon view (y=0), azimuth sweeping away from the sun → cos_sun falls monotonically
      const view = norm([Math.sin(a), 0, Math.cos(a)])
      const lum = luminance(sample_sky_rgb(view, DAY_SUN))
      expect(lum).toBeLessThanOrEqual(prev + 1e-9)
      prev = lum
    }
  })

  test('looking at the sun is brighter than the zenith (daytime halo peak)', () => {
    const at_sun = luminance(sample_sky_rgb(DAY_SUN, DAY_SUN))
    const at_zenith = luminance(sample_sky_rgb([0, 1, 0], DAY_SUN))
    expect(at_sun).toBeGreaterThan(at_zenith * 2)
  })

  test('radiance toward the sun ≥ radiance directly away, at matched elevation', () => {
    const toward = luminance(sample_sky_rgb(DAY_SUN, DAY_SUN))
    const away = luminance(sample_sky_rgb(norm([0, 0.6, -0.8]), DAY_SUN))
    expect(toward).toBeGreaterThan(away)
  })
})

describe('sample_sky_rgb — time of day', () => {
  test('daytime sky is brighter than night sky at every cardinal view', () => {
    for (const view of [
      [0, 1, 0],
      [0, 0, 1],
      [1, 0, 0],
      [0, 0.5, 0.5],
    ]) {
      const v = norm(/** @type {[number,number,number]} */ (view))
      expect(luminance(sample_sky_rgb(v, DAY_SUN))).toBeGreaterThan(luminance(sample_sky_rgb(v, NIGHT_SUN)))
    }
  })

  test('dusk horizon is warm (r>b); midday horizon is cool (b>r)', () => {
    const dusk = palette_for_sun(0.0).horizon
    const midday = palette_for_sun(0.7).horizon
    expect(dusk[0]).toBeGreaterThan(dusk[2]) // warm
    expect(midday[2]).toBeGreaterThan(midday[0]) // cool
  })

  test('sun tint reddens toward dusk', () => {
    const day = sun_tint_for(0.7)
    const dusk = sun_tint_for(0.0)
    // orange dusk tint drops the blue channel relative to warm-white day
    expect(dusk[2]).toBeLessThan(day[2])
  })

  test('palette endpoints resolve to the day/dusk keyframes', () => {
    expect(palette_for_sun(0.9).zenith).toEqual(SKY_DAY.zenith)
    // sun_y ≈ -0.02..0.0 sits at the dusk keyframe (between night and day)
    expect(palette_for_sun(-0.02).horizon).toEqual(SKY_DUSK.horizon)
  })

  test('sky radiance is finite and lower-bounded at 0 across a grid', () => {
    for (let sy = -0.5; sy <= 0.98; sy += 0.25) {
      const sun = norm([0.3, sy, 0.7])
      for (let vy = -1; vy <= 1; vy += 0.4) {
        const c = sample_sky_rgb(norm([0.5, vy, 0.5]), sun)
        for (const ch of c) {
          expect(Number.isFinite(ch)).toBe(true)
          expect(ch).toBeGreaterThanOrEqual(0)
        }
      }
    }
  })
})

describe('sun_dir_from_tod — cycle model', () => {
  test('always a unit vector', () => {
    for (let t = 0; t < 1; t += 0.05) {
      const d = sun_dir_from_tod(t)
      expect(d.length()).toBeCloseTo(1, 6)
    }
  })

  test('sun is above the horizon through the day portion, below through the night', () => {
    for (let t = 0.02; t < DAY_FRAC - 0.02; t += 0.05) {
      expect(sun_dir_from_tod(t).y).toBeGreaterThan(0)
    }
    for (let t = DAY_FRAC + 0.02; t < 0.98; t += 0.05) {
      expect(sun_dir_from_tod(t).y).toBeLessThan(0)
    }
  })

  test('elevation rises to a noon peak then falls (day portion)', () => {
    const noon = DAY_FRAC / 2
    const peak = sun_dir_from_tod(noon).y
    expect(peak).toBeGreaterThan(0.9)
    // rising before noon
    expect(sun_dir_from_tod(noon - 0.1).y).toBeLessThan(peak)
    // falling after noon
    expect(sun_dir_from_tod(noon + 0.1).y).toBeLessThan(peak)
  })

  test('continuous at the day/night handoffs (y≈0)', () => {
    expect(sun_dir_from_tod(0).y).toBeCloseTo(0, 6)
    expect(sun_dir_from_tod(DAY_FRAC).y).toBeCloseTo(0, 6)
    expect(sun_dir_from_tod(0.999999).y).toBeCloseTo(0, 3)
  })

  test('phase wraps into [0,1)', () => {
    const a = sun_dir_from_tod(0.3)
    const b = sun_dir_from_tod(1.3)
    expect(b.x).toBeCloseTo(a.x, 9)
    expect(b.y).toBeCloseTo(a.y, 9)
    expect(b.z).toBeCloseTo(a.z, 9)
  })
})

// 2026-07-12 moon polish: the moon needed real surface texture and light rays, not a flat circle — the
// disc-space UV that anchors the moon's surface texture to the BODY (not the camera). Pure-JS twin of the
// TSL mirror in this file (see disc_space_uv). 2026-07-13: the maria/rim SHAPE itself is now a real
// photographic texture (moon_texture(), sampled directly in TSL — see the create_sky_node smoke test below;
// no pure-JS twin to test, there's no math left to mirror).
describe('disc_space_uv_js — stable disc-local coordinate (camera-independent)', () => {
  const MOON_ELEVATIONS = [-0.05, 0, 0.15, 0.3, 0.5] // the moon's real operating range (moon_up gates ≥ -0.02)
  const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const len3 = (a) => Math.sqrt(dot3(a, a))

  test('zero at dead centre (view_dir === body_dir)', () => {
    for (const y of MOON_ELEVATIONS) {
      const body = norm([0.6, y, 0.5])
      const [u, v] = disc_space_uv_js(body, body)
      expect(Math.abs(u)).toBeLessThan(1e-9)
      expect(Math.abs(v)).toBeLessThan(1e-9)
    }
  })

  test('the implied tangent basis is orthonormal across the real elevation range (no degenerate singularity)', () => {
    // disc_space_uv_js(view,body) = [dot(view,tu), dot(view,tv)] — linear in view_dir, so probing the 3
    // standard basis vectors recovers tu/tv component-by-component exactly (a pure linear-algebra trick,
    // not a physical view direction).
    for (const y of MOON_ELEVATIONS) {
      const body = norm([0.6, y, 0.5])
      const tu = [0, 1, 2].map((i) => disc_space_uv_js([i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0], body)[0])
      const tv = [0, 1, 2].map((i) => disc_space_uv_js([i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0], body)[1])
      expect(len3(tu)).toBeCloseTo(1, 6)
      expect(len3(tv)).toBeCloseTo(1, 6)
      expect(dot3(tu, tv)).toBeCloseTo(0, 6) // tu ⟂ tv
      expect(dot3(tu, body)).toBeCloseTo(0, 6) // both tangents ⟂ the body direction itself
      expect(dot3(tv, body)).toBeCloseTo(0, 6)
    }
  })

  test('pure/deterministic — depends only on the WORLD directions, never on how a camera reached them', () => {
    const body = norm([0.2, 0.3, 0.9])
    const view = norm([0.25, 0.35, 0.88])
    const a = disc_space_uv_js(view, body)
    const b = disc_space_uv_js(view.slice(), body.slice()) // fresh arrays, same world values
    expect(a).toEqual(b)
  })

  test('|uv| grows ~linearly with a small angular offset (a genuine local coordinate, not constant/degenerate)', () => {
    const body = norm([0.3, 0.2, 0.9])
    const mag = (uv) => Math.hypot(uv[0], uv[1])
    const m_small = mag(disc_space_uv_js(norm([body[0], body[1] + 0.01, body[2]]), body))
    const m_big = mag(disc_space_uv_js(norm([body[0], body[1] + 0.02, body[2]]), body))
    expect(m_big).toBeGreaterThan(m_small * 1.5)
  })
})

describe('create_sky_node — LOW-tier background construction (CPU-side, no GPU)', () => {
  // GPU/TSL behavior is normally out of this file's scope (see header) — this ONE smoke test is the
  // exception: 2026-07-12 added real TSL disc-space-UV math to the moon path (mirrors hillaire_sky.test.js's
  // own construction-only pattern), so it earns a minimal "does it even build" gate. 2026-07-13: the moon
  // path now also lazy-loads moon_texture() — headless-safe (probed: a bare Texture stand-in builds a valid
  // TSL texture() node with zero document/GPU), so this stays a true CPU-only smoke test.
  test('builds background_node without throwing (moon disc-space texture + corona included)', () => {
    const sky = create_sky_node()
    expect(sky.background_node).toBeTruthy()
    expect(sky.sample_sky).toBeInstanceOf(Function)
  })
})
