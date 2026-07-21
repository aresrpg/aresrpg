// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure-config/-math tests for the NG2-ATMO composition module. Pins the CONFIG contracts + the pure
// helpers the phase-2 wiring depends on: cloud altitudes clear the sky-island band (design note),
// the default config validates, the NEAR-haze ramp (the "more haze" requirement) behaves, the ambient-depth
// interior-recede curve (constraint #2) is monotone and hits the right endpoints, sun_radiance
// tracks the dusk warmth + fades below the horizon, and the §M point-light scatter closed form
// (atan integral) matches a brute-force numeric reference. GPU passes are the wiring wave's concern.

import { test, expect, describe } from 'bun:test'

import {
  AMBIENT_EXTERIOR_SCALE,
  AMBIENT_INTERIOR_SCALE,
  AMBIENT_SHADE_TINT,
  ATMO_CONFIG,
  CLOUD_BOTTOM,
  CLOUD_TOP,
  POINT_SCATTER_MIN_H,
  ambient_depth_scale_f,
  ambient_tint_f,
  near_haze_sigma,
  point_scatter_integral,
  sun_radiance_for,
  validate_atmo_config,
} from './atmosphere.js'

// the sky-island band the clouds must sit above (SPEC: islands ~290-350).
const MAX_ISLAND_Y = 350

describe('cloud altitudes retuned for our world (design note)', () => {
  test('deck sits ABOVE the highest sky island so islands read below it', () => {
    expect(CLOUD_BOTTOM).toBeGreaterThan(MAX_ISLAND_Y)
  })

  test('slab is thick enough to read as volume at 32 steps', () => {
    expect(CLOUD_TOP - CLOUD_BOTTOM).toBeGreaterThanOrEqual(60)
  })

  test('finals: bottom 460 / top 700 (240m slab, ~110m gap over islands)', () => {
    expect(CLOUD_BOTTOM).toBe(460)
    expect(CLOUD_TOP).toBe(700)
    expect(CLOUD_BOTTOM - MAX_ISLAND_Y).toBeGreaterThanOrEqual(100)
  })
})

describe('validate_atmo_config', () => {
  test('the shipped default config is valid', () => {
    expect(validate_atmo_config(ATMO_CONFIG, MAX_ISLAND_Y)).toEqual([])
  })

  test('catches clouds below the island band', () => {
    const bad = structuredClone(ATMO_CONFIG)
    bad.cloud.bottom = 200
    bad.cloud.top = 300
    const problems = validate_atmo_config(bad, MAX_ISLAND_Y)
    expect(problems.some((p) => p.includes('max island'))).toBe(true)
  })

  test('catches inverted slab, negative haze, out-of-range coverage', () => {
    const bad = structuredClone(ATMO_CONFIG)
    bad.cloud.bottom = 700
    bad.cloud.top = 460 // inverted
    bad.cloud.coverage = 1.5
    bad.froxel.near_haze = -1
    const problems = validate_atmo_config(bad, MAX_ISLAND_Y)
    expect(problems.length).toBeGreaterThanOrEqual(3)
  })

  test('catches a contrast that would crush instead of lift', () => {
    const bad = structuredClone(ATMO_CONFIG)
    bad.grade.contrast = 0.8
    expect(validate_atmo_config(bad, MAX_ISLAND_Y).some((p) => p.includes('contrast'))).toBe(true)
  })
})

describe('near_haze_sigma — CONSTANT floor (the 2026-07-05 SHELL KILL)', () => {
  const f = ATMO_CONFIG.froxel

  // The old camera-DISTANCE window (rise/hold/fade) was a fog donut welded to the camera — the base
  // camera-locked opacity structure of the reported "huge static circle texture following me". These
  // tests PIN the constant-floor contract so a window can never silently return.
  test('CONSTANT at every distance — zero camera-anchored structure by construction', () => {
    expect(near_haze_sigma(0, f)).toBeCloseTo(f.near_haze, 12)
    expect(near_haze_sigma(55, f)).toBeCloseTo(f.near_haze, 12)
    expect(near_haze_sigma(120, f)).toBeCloseTo(f.near_haze, 12)
    expect(near_haze_sigma(480, f)).toBeCloseTo(f.near_haze, 12)
  })

  test('total optical depth over the froxel range: visible depth, never a wall', () => {
    const tau = f.near_haze * 480 // constant σ ⇒ τ = σ·range
    expect(tau).toBeGreaterThan(0.15) // actually visible (more haze was the ask)
    expect(tau).toBeLessThan(0.8) // never a whiteout wall (τ 0.58 at the shipped σ)
  })

  test('mid-range carries a subtle veil; the far plane reads hazed but not opaque', () => {
    const veil_120 = 1 - Math.exp(-near_haze_sigma(120, f) * 120)
    expect(veil_120).toBeGreaterThan(0.03) // visible seasoning
    expect(veil_120).toBeLessThan(0.35) // not a wall
    const veil_480 = 1 - Math.exp(-near_haze_sigma(480, f) * 480)
    expect(veil_480).toBeLessThan(0.6) // far plane: aerial depth, never opaque
  })

  test('validate catches an inverted/overdense window', () => {
    const bad = structuredClone(ATMO_CONFIG)
    bad.froxel.near_fade_end_m = bad.froxel.near_fade_start_m - 10
    expect(validate_atmo_config(bad, MAX_ISLAND_Y).some((p) => p.includes('near_fade_end_m'))).toBe(true)
    const dense = structuredClone(ATMO_CONFIG)
    dense.froxel.near_haze = 0.01 // τ ≈ 1.4 over the band — a wall
    expect(validate_atmo_config(dense, MAX_ISLAND_Y).some((p) => p.includes('whiteout'))).toBe(true)
  })

  test('OWNER FOG LAW knobs: clear day defaults to seasoning; drama is conditional', () => {
    // weather multiplier defaults to CLEAR (1) — the weather wave raises it, never the default.
    expect(ATMO_CONFIG.froxel.weather_density).toBe(1)
    // altitude band sits at the peaks/cloud approach (heavy haze legal ~y260+).
    expect(ATMO_CONFIG.froxel.altitude_haze_start_y).toBeGreaterThanOrEqual(240)
    expect(ATMO_CONFIG.froxel.altitude_haze_full_y).toBeGreaterThan(ATMO_CONFIG.froxel.altitude_haze_start_y)
    // validate rejects nonsense weather/altitude values.
    const bad = structuredClone(ATMO_CONFIG)
    bad.froxel.weather_density = -1
    bad.froxel.altitude_haze_full_y = bad.froxel.altitude_haze_start_y - 5
    bad.froxel.altitude_haze_boost = 50
    const problems = validate_atmo_config(bad, MAX_ISLAND_Y)
    expect(problems.some((p) => p.includes('weather_density'))).toBe(true)
    expect(problems.some((p) => p.includes('altitude_haze_full_y'))).toBe(true)
    expect(problems.some((p) => p.includes('altitude_haze_boost'))).toBe(true)
  })
})

describe('ambient_depth_scale — interior cells recede (constraint #2)', () => {
  test('interior (BFS sun 0) drops to the interior scale; exterior (1) stays full', () => {
    expect(ambient_depth_scale_f(0)).toBeCloseTo(AMBIENT_INTERIOR_SCALE, 9)
    expect(ambient_depth_scale_f(1)).toBeCloseTo(AMBIENT_EXTERIOR_SCALE, 9)
  })

  test('interior scale actually recedes (< exterior) so structure reads', () => {
    expect(AMBIENT_INTERIOR_SCALE).toBeLessThan(AMBIENT_EXTERIOR_SCALE)
    expect(AMBIENT_INTERIOR_SCALE).toBeGreaterThanOrEqual(0.55) // not a black hole — a gentle recede
    // ENG-10 REBALANCE: upper bound relaxed 0.7 → 0.8. The enclosure FOG now carries the under-canopy
    // mood from the air (target: interior SURFACES stay light+clear; DISTANCE darkens, not albedo), so
    // the interior ambient recede is gentler — nearby textures read legibly, fog dissolves the depth.
    expect(AMBIENT_INTERIOR_SCALE).toBeLessThanOrEqual(0.8)
  })

  test('monotone increasing across the BFS range', () => {
    let prev = -1
    for (let b = 0; b <= 1.0001; b += 0.05) {
      const s = ambient_depth_scale_f(b)
      expect(s).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = s
    }
  })
})

describe('ambient_tint — cool sky-blue shade interior, neutral in open (design ref: sky-lit shade = cool)', () => {
  test('open ground (v_sun 1) is neutral white — sunlit risers stay warm (de-cyan guard)', () => {
    const t = ambient_tint_f(1)
    expect(t[0]).toBeCloseTo(1, 9)
    expect(t[1]).toBeCloseTo(1, 9)
    expect(t[2]).toBeCloseTo(1, 9)
  })

  test('deep interior (v_sun 0) casts COOL: blue lifted above neutral, red suppressed', () => {
    const t = ambient_tint_f(0)
    expect(t).toEqual([...AMBIENT_SHADE_TINT])
    expect(t[2]).toBeGreaterThan(1) // blue lifted
    expect(t[0]).toBeLessThan(1) // red suppressed
    expect(t[2]).toBeGreaterThan(t[0]) // net cool cast (blue > red)
  })

  test('BOUNDED — cool photographic shade, not a full smurf recolor (every channel within ±50% of neutral)', () => {
    // ENG-12 crank ([0.55,0.72,1.35]) reads clearly blue at a glance (target: "not blue enough") — past
    // the old ±25% envelope, but still a tint MULTIPLIER, not a repaint. The real perceptual smurf guard
    // is the runtime A/B (bench/shade_verify.spec.js [retired, issue #74]: deep-shade Δ(b−r) < 0.12); this is just a sanity cap.
    for (const c of AMBIENT_SHADE_TINT) expect(Math.abs(c - 1)).toBeLessThanOrEqual(0.5)
  })

  test('every channel moves monotonically toward neutral as the sky reaches deeper (v_sun 0→1)', () => {
    let prev = ambient_tint_f(0)
    for (let b = 0.05; b <= 1.0001; b += 0.05) {
      const t = ambient_tint_f(b)
      for (let ch = 0; ch < 3; ch++) expect(Math.abs(t[ch] - 1)).toBeLessThanOrEqual(Math.abs(prev[ch] - 1) + 1e-9)
      prev = t
    }
  })
})

describe('sun_radiance_for — matches sky warmth, fades below horizon', () => {
  test('daytime radiance is warm-bright (r ≥ b) and positive', () => {
    const r = sun_radiance_for(0.8)
    expect(r[0]).toBeGreaterThan(0)
    expect(r[0]).toBeGreaterThanOrEqual(r[2]) // warm-white or warmer
  })

  test('dusk radiance reddens (r/b ratio grows vs midday)', () => {
    const midday = sun_radiance_for(0.8)
    const dusk = sun_radiance_for(0.02)
    expect(dusk[0] / Math.max(dusk[2], 1e-6)).toBeGreaterThan(midday[0] / Math.max(midday[2], 1e-6))
  })

  test('below the horizon the sun stops lighting clouds/fog (≈0)', () => {
    const night = sun_radiance_for(-0.3)
    for (const c of night) expect(c).toBeCloseTo(0, 6)
  })

  test('intensity scales linearly above the horizon', () => {
    const a = sun_radiance_for(0.8, 8)
    const b = sun_radiance_for(0.8, 16)
    expect(b[0]).toBeCloseTo(a[0] * 2, 5)
  })
})

// ── §M point-light scatter — closed-form atan integral vs numeric reference (reference-sourced) ────────
// Technique: https://ijdykeman.github.io/graphics/simple_fog_shader. The shipped TSL node (ENG-5
// wave) will mirror `point_scatter_integral`; these tests are its correctness contract.
describe('point_scatter_integral — atan closed form vs brute-force RTE reference', () => {
  /** independent numeric reference: midpoint Riemann sum of ∫₀ᵈ dt/|P(t)−L|² along the ray.
   * @param {[number,number,number]} cam @param {[number,number,number]} dir @param {number} d
   * @param {[number,number,number]} light @param {number} [steps] @returns {number} */
  function brute_scatter(cam, dir, d, light, steps = 200_000) {
    let sum = 0
    const dt = d / steps
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) * dt
      const dx = cam[0] + dir[0] * t - light[0]
      const dy = cam[1] + dir[1] * t - light[1]
      const dz = cam[2] + dir[2] * t - light[2]
      sum += dt / (dx * dx + dy * dy + dz * dz)
    }
    return sum
  }

  /** @param {[number,number,number]} v @returns {[number,number,number]} */
  const norm = (v) => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1
    return [v[0] / l, v[1] / l, v[2] / l]
  }
  const CAM = /** @type {[number,number,number]} */ ([3, 45, -7]) // arbitrary world-ish origin

  test('matches the numeric reference across light configurations (h > clamp)', () => {
    /** @type {Array<{dir:[number,number,number], light:[number,number,number], d:number}>} */
    const cases = [
      // light ahead of the camera, off-axis (the torch-down-the-corridor case)
      { dir: norm([0, 0, 1]), light: [CAM[0] + 2, CAM[1] + 1, CAM[2] + 10], d: 40 },
      // light BEHIND the camera (t_c < 0) — glow from a light you walked past
      { dir: norm([0, 0, 1]), light: [CAM[0] + 1, CAM[1] + 0.5, CAM[2] - 6], d: 25 },
      // fragment SHORT of closest approach (d < t_c) — wall before the mushroom
      { dir: norm([0, 0, 1]), light: [CAM[0] + 0.5, CAM[1], CAM[2] + 30], d: 8 },
      // diagonal ray, elevated light (cavern ceiling glow)
      { dir: norm([1, 0.3, 1]), light: [CAM[0] + 8, CAM[1] + 6, CAM[2] + 5], d: 30 },
    ]
    for (const c of cases) {
      const closed = point_scatter_integral(CAM, c.dir, c.d, c.light)
      const brute = brute_scatter(CAM, c.dir, c.d, c.light)
      expect(Math.abs(closed - brute) / brute).toBeLessThan(1e-3)
    }
  })

  test('never exceeds the full-line bound π/h (the §M bounding-sphere bound)', () => {
    for (const [ox, oy, d] of [
      [2, 1, 40],
      [0.6, 0.3, 500],
      [5, -2, 12],
    ]) {
      const dir = /** @type {[number,number,number]} */ ([0, 0, 1])
      const light = /** @type {[number,number,number]} */ ([CAM[0] + ox, CAM[1] + oy, CAM[2] + 9])
      const h = Math.max(Math.hypot(ox, oy), POINT_SCATTER_MIN_H)
      expect(point_scatter_integral(CAM, dir, d, light)).toBeLessThanOrEqual(Math.PI / h + 1e-9)
    }
  })

  test('monotone non-decreasing in fragment distance (more fog path ⇒ more glow)', () => {
    const dir = /** @type {[number,number,number]} */ ([0, 0, 1])
    const light = /** @type {[number,number,number]} */ ([CAM[0] + 1.5, CAM[1], CAM[2] + 12])
    let prev = -1
    for (let d = 0; d <= 60; d += 2) {
      const v = point_scatter_integral(CAM, dir, d, light)
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12)
      prev = v
    }
  })

  test('ray THROUGH the light centre: h clamps to the bulb radius — finite, bounded, no NaN', () => {
    const dir = /** @type {[number,number,number]} */ ([0, 0, 1])
    const light = /** @type {[number,number,number]} */ ([CAM[0], CAM[1], CAM[2] + 5]) // dead on the ray
    const v = point_scatter_integral(CAM, dir, 20, light)
    expect(Number.isFinite(v)).toBe(true)
    expect(v).toBeGreaterThan(0)
    expect(v).toBeLessThanOrEqual(Math.PI / POINT_SCATTER_MIN_H + 1e-9)
  })

  test('zero-length segment scatters nothing', () => {
    const dir = /** @type {[number,number,number]} */ ([0, 0, 1])
    const light = /** @type {[number,number,number]} */ ([CAM[0] + 2, CAM[1], CAM[2] + 10])
    expect(point_scatter_integral(CAM, dir, 0, light)).toBeCloseTo(0, 12)
  })
})
