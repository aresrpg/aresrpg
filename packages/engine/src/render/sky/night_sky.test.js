// Night-sky pure math — illuminate the sky: beautiful stars, planets, milky way.
// Pins: (1) the anti-"lamp" kernels are BOUNDARY-FREE + monotone (the windowed-corona disease can never
// return), (2) the dusk gate is gradual and exactly 0 in daylight, (3) star fades behave, (4) the seed →
// params derivation is deterministic, unit-length, orthonormal, and actually varies across seeds,
// (5) planets drift slowly + deterministically with the tod signal, (6) the TSL node builds CPU-side for
// both tier configs (no GPU needed — the hillaire/sky_node construction pattern).

import { describe, expect, test } from 'bun:test'

import {
  create_night_sky_node,
  derive_night_sky_params,
  horizon_fade_js,
  moon_halo_js,
  moon_sky_glow_js,
  night_gate_js,
  planet_dir_js,
  star_moon_fade_js,
  MW_CORE_RGB,
  MW_INTENSITY,
  NIGHT_SKY_LIVE,
  STAR_HORIZON_FLOOR,
  STAR_MOON_SUPPRESS,
  STAR_TIERS,
  STAR_WARM_RGB,
} from './night_sky.js'
import { SKY_NIGHT, luminance } from './sky_node.js'

const deg = (/** @type {number} */ d) => Math.cos((d * Math.PI) / 180)
const elev_y = (/** @type {number} */ d) => Math.sin((d * Math.PI) / 180) // view_dir.y for an elevation in °

describe('moon kernels — boundary-free (the anti-"lamp" law)', () => {
  test('sky glow: monotone decreasing away from the moon, no boundary anywhere, still alive at 90°', () => {
    let prev = Infinity
    for (let d = 0; d <= 180; d += 1) {
      const v = moon_sky_glow_js(deg(d))
      expect(v).toBeLessThanOrEqual(prev + 1e-12)
      expect(v).toBeGreaterThan(0) // NEVER exactly zero — no window edge to read as a bubble rim
      prev = v
    }
    expect(moon_sky_glow_js(deg(0))).toBeCloseTo(1, 9)
    expect(moon_sky_glow_js(deg(90))).toBeGreaterThan(0.003) // the faint whole-dome illumination
    expect(moon_sky_glow_js(deg(90))).toBeLessThan(0.02) // …but genuinely faint (sky glow, not a wash)
  })

  test('near halo: monotone decreasing, a few degrees of presence, gone (<1%) by 20°, never negative', () => {
    let prev = Infinity
    for (let d = 0; d <= 90; d += 0.25) {
      const v = moon_halo_js(deg(d))
      expect(v).toBeLessThanOrEqual(prev + 1e-12)
      expect(v).toBeGreaterThanOrEqual(0)
      prev = v
    }
    expect(moon_halo_js(deg(1.5))).toBeGreaterThan(0.05) // present right off the disc (r≈1.5°)
    expect(moon_halo_js(deg(20))).toBeLessThan(0.01) // long gone — the glow term owns the far field
  })
})

describe('night gate — gradual dusk fade-in, hard daylight zero', () => {
  test('0 through all of daylight, 1 in deep night, strictly between through dusk', () => {
    for (const y of [0.9, 0.5, 0.1, 0.0, -0.02]) expect(night_gate_js(y)).toBe(0)
    for (const y of [-0.15, -0.3, -0.5]) expect(night_gate_js(y)).toBe(1)
    const mid = night_gate_js(-0.085)
    expect(mid).toBeGreaterThan(0.2)
    expect(mid).toBeLessThan(0.8)
    // monotone into the night (no flicker across the dusk band)
    let prev = -1
    for (let y = 0; y >= -0.2; y -= 0.005) {
      const v = night_gate_js(y)
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12)
      prev = v
    }
  })
})

describe('star fades', () => {
  test('suppressed (but never dead) at the moon, full far away, monotone recovery', () => {
    expect(star_moon_fade_js(1, 1)).toBeCloseTo(1 - STAR_MOON_SUPPRESS, 6)
    expect(star_moon_fade_js(-1, 1)).toBeGreaterThan(0.98)
    expect(star_moon_fade_js(1, 0)).toBe(1) // moon below the horizon ⇒ no suppression
    let prev = 0
    for (let d = 0; d <= 180; d += 2) {
      const v = star_moon_fade_js(deg(d), 1)
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12)
      prev = v
    }
  })
})

describe('horizon extinction — the sky sinks into the terrain instead of cutting straight', () => {
  test('OFF (null/NEUTRAL) is always 1 — no fade, byte-unchanged graph', () => {
    expect(horizon_fade_js(elev_y(0), null)).toBe(1)
    expect(horizon_fade_js(elev_y(90), null)).toBe(1)
    expect(horizon_fade_js(elev_y(0), undefined)).toBe(1)
  })

  test('ON (the shipped NIGHT_SKY_LIVE window): 0 at/below the horizon, 1 at/above start_deg, zenith untouched', () => {
    const hf = NIGHT_SKY_LIVE.horizon_fade
    expect(hf).toBeTruthy() // the fix must actually be wired into the shipped cfg
    expect(horizon_fade_js(elev_y(hf.end_deg), hf)).toBeCloseTo(0, 9) // the true horizon: fully extinct
    expect(horizon_fade_js(elev_y(hf.start_deg), hf)).toBeCloseTo(1, 9) // fully clear by start_deg
    expect(horizon_fade_js(elev_y(90), hf)).toBeCloseTo(1, 9) // zenith: untouched, full intensity
    expect(horizon_fade_js(1, hf)).toBeCloseTo(1, 9) // straight up (view_dir.y=1): untouched
  })

  test('monotonic non-decreasing from the horizon up to the zenith, strictly partial mid-ramp', () => {
    const hf = NIGHT_SKY_LIVE.horizon_fade
    let prev = -1
    for (let d = hf.end_deg; d <= 90; d += 0.5) {
      const v = horizon_fade_js(elev_y(d), hf)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12)
      prev = v
    }
    const mid = horizon_fade_js(elev_y((hf.start_deg + hf.end_deg) / 2), hf)
    expect(mid).toBeGreaterThan(0.05) // a real gradient, not a step function
    expect(mid).toBeLessThan(0.95)
  })

  test('band/nebula fade ALL THE WAY to 0 at the horizon; stars only dim to STAR_HORIZON_FLOOR (never vanish)', () => {
    const hf = NIGHT_SKY_LIVE.horizon_fade
    const ext_band_at_horizon = horizon_fade_js(elev_y(hf.end_deg), hf) // milky way / nebula consume this raw
    const ext_star_at_horizon = STAR_HORIZON_FLOOR + (1 - STAR_HORIZON_FLOOR) * ext_band_at_horizon // stars: mix(FLOOR,1,hf)
    expect(ext_band_at_horizon).toBeCloseTo(0, 9)
    expect(ext_star_at_horizon).toBeCloseTo(STAR_HORIZON_FLOOR, 9)
    expect(STAR_HORIZON_FLOOR).toBeCloseTo(0.5, 9)
    expect(STAR_HORIZON_FLOOR).toBeGreaterThan(0) // "shouldn't vanish entirely"
  })
})

describe('derive_night_sky_params — the per-world seed derivation', () => {
  test('deterministic, unit vectors, orthonormal galaxy basis, band never a horizon ring', () => {
    for (const seed of ['aresrpg', 'khumbu', 42, 'emberfall']) {
      const a = derive_night_sky_params(seed)
      const b = derive_night_sky_params(seed)
      expect(a).toEqual(b) // deterministic
      const len = (/** @type {number[]} */ v) => Math.hypot(v[0], v[1], v[2])
      const dot = (/** @type {number[]} */ u, /** @type {number[]} */ v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2]
      expect(len(a.galaxy_n)).toBeCloseTo(1, 9)
      expect(len(a.galaxy_a)).toBeCloseTo(1, 9)
      expect(len(a.galaxy_b)).toBeCloseTo(1, 9)
      expect(Math.abs(dot(a.galaxy_n, a.galaxy_a))).toBeLessThan(1e-9)
      expect(Math.abs(dot(a.galaxy_n, a.galaxy_b))).toBeLessThan(1e-9)
      expect(Math.abs(dot(a.galaxy_a, a.galaxy_b))).toBeLessThan(1e-9)
      expect(Math.abs(a.galaxy_n[1])).toBeLessThanOrEqual(0.72) // pole clamped ⇒ band visibly tilted
      expect(Math.abs(a.density_shift)).toBeLessThanOrEqual(0.02)
      for (const p of a.planets) {
        expect(len(p.a)).toBeCloseTo(1, 9)
        expect(len(p.b)).toBeCloseTo(1, 9)
        expect(Math.abs(dot(p.a, p.b))).toBeLessThan(1e-9)
        expect(p.drift).toBeGreaterThan(0.03)
        expect(p.drift).toBeLessThan(0.09)
      }
    }
  })

  test('different seeds give different skies (galaxy orientation actually varies)', () => {
    const a = derive_night_sky_params('aresrpg')
    const b = derive_night_sky_params('khumbu')
    const d =
      Math.abs(a.galaxy_n[0] - b.galaxy_n[0]) +
      Math.abs(a.galaxy_n[1] - b.galaxy_n[1]) +
      Math.abs(a.galaxy_n[2] - b.galaxy_n[2])
    expect(d).toBeGreaterThan(0.05)
  })
})

describe('stars — luminance discipline (the bloom-knee law)', () => {
  test('the worst single star (brightest tier config, warm tint, full in-band boost) + band glow + base < knee', () => {
    const worst_star = Math.max(...STAR_TIERS.map((t) => t.bright * (1 + t.band_bright))) * luminance(STAR_WARM_RGB)
    const band_glow = MW_INTENSITY * luminance(MW_CORE_RGB)
    const base = luminance(SKY_NIGHT.horizon)
    // two stars of DIFFERENT tiers can rarely overlap sub-pixel and briefly cross the knee — accepted as a
    // "bright double star" glint (the planet-glint class); the SINGLE-star stack must stay under.
    expect(worst_star + band_glow + base).toBeLessThan(2.05)
  })

  // The SHIPPED config (H2) turns brightness/nebula knobs UP, so the module-constant
  // check above no longer bounds what actually renders. This bounds NIGHT_SKY_LIVE itself: the worst in-band
  // star (its star_bright_mul) + band glow (its mw) + the brightest nebula colour (base + all regions, at its
  // intensity) + its base must clear the same 2.05 knee, or the HIGH-tier bloom blows the sky to white.
  test('the SHIPPED config (NIGHT_SKY_LIVE) stays under the 2.05 bloom knee', () => {
    const cfg = NIGHT_SKY_LIVE
    const worst_star =
      Math.max(...STAR_TIERS.map((t) => t.bright * (1 + t.band_bright))) *
      cfg.star_bright_mul *
      luminance(STAR_WARM_RGB)
    const band_glow = cfg.mw_intensity * luminance(cfg.mw_rgb)
    const neb = cfg.nebula
    const nebula_peak =
      Math.max(
        luminance(neb.blue),
        luminance(neb.purple),
        luminance(neb.orange),
        ...(neb.regions ?? []).map((r) => luminance(r.rgb))
      ) * neb.intensity
    const base = luminance(cfg.base_palette.horizon)
    const total = worst_star + band_glow + nebula_peak + base
    expect(total).toBeLessThan(2.05) // hand-calc H2 (in-engine-tuned mw 0.10 / nebula 0.9) ≈ 1.95
    expect(cfg.star_bright_mul).toBeLessThanOrEqual(1.1) // brightness knob stays knee-safe; density carries "more stars"
  })
})

describe('planet drift — slow, deterministic, unit', () => {
  test('unit direction; a full sun-azimuth sweep moves it a small, nonzero arc', () => {
    const P = derive_night_sky_params('aresrpg')
    for (const p of P.planets) {
      const d0 = planet_dir_js(p, 0)
      const d1 = planet_dir_js(p, Math.PI * 2) // a whole day of azimuth
      expect(Math.hypot(d0[0], d0[1], d0[2])).toBeCloseTo(1, 9)
      const cosarc = d0[0] * d1[0] + d0[1] * d1[1] + d0[2] * d1[2]
      const arc = Math.acos(Math.min(1, Math.max(-1, cosarc)))
      expect(arc).toBeGreaterThan(0.05) // it DOES drift…
      expect(arc).toBeLessThan(0.6) // …VERY slowly (≪ a radian per full day)
      expect(planet_dir_js(p, 1.234)).toEqual(planet_dir_js(p, 1.234)) // deterministic
    }
  })

  test('the two planets are distinct directions', () => {
    const P = derive_night_sky_params('aresrpg')
    const [p0, p1] = P.planets.map((p) => planet_dir_js(p, 0))
    const cos01 = p0[0] * p1[0] + p0[1] * p1[1] + p0[2] * p1[2]
    expect(cos01).toBeLessThan(0.999) // not the same point in the sky
  })
})

describe('create_night_sky_node — CPU-side construction (both tier configs)', () => {
  test('builds the node + tick for the LOW config (stars+planets) and the full config (base+milky way)', async () => {
    const { uniform, positionWorldDirection } = await import('three/tsl')
    const { Vector3 } = await import('three')
    const sun_dir = uniform(new Vector3(0.2, -0.4, 0.89).normalize())
    const view = positionWorldDirection.normalize()
    for (const cfg of [
      { with_base: false, with_milky_way: false },
      { with_base: true, with_milky_way: true },
    ]) {
      const night = create_night_sky_node({ seed: 'aresrpg', sun_dir, view_dir: view, ...cfg })
      expect(night.node).toBeTruthy()
      expect(night.params.planets).toHaveLength(2)
      expect(() => night.tick(sun_dir.value)).not.toThrow() // planet uniforms update off the live sun
    }
  })
})
