// Pure-math tests for the physically-based god rays — the load-bearing correctness the TSL shader
// mirrors. Same split as froxels.test.js: the GPU node is proven by the probe screenshots; here we pin
// the three formulas the shader copies (HG phase / height density / front-to-back in-scatter) against
// independent references, then prove the THREE acceptance BEHAVIORS at the math level:
//   • an open, off-sun path adds ≈ZERO veil (the non-washout guarantee — the whole point);
//   • a sunward shaft is many× brighter than the same path off-sun (phase → shafts bloom toward the sun);
//   • a fully-shadowed path is exactly 0 regardless of phase (the shadow gate → caves stay dark).

import { describe, expect, test } from 'bun:test'

import { GODRAYS_DEFAULTS, hg_phase, height_density, integrate_inscatter } from './god_rays.js'

const FOUR_PI = 4 * Math.PI

/** Numerically integrate a phase function over the full sphere: 2π ∫_{-1}^{1} p(μ) dμ (azimuthally
 *  symmetric). Fine midpoint rule. @param {(mu:number)=>number} p @param {number} [n] @returns {number} */
function sphere_integral(p, n = 200000) {
  let s = 0
  const dmu = 2 / n
  for (let i = 0; i < n; i++) {
    const mu = -1 + (i + 0.5) * dmu
    s += p(mu) * dmu
  }
  return 2 * Math.PI * s
}

describe('hg_phase — Henyey-Greenstein', () => {
  test('normalises to 1 over the sphere for a range of g', () => {
    for (const g of [0, 0.2, 0.5, 0.65, 0.8]) {
      expect(sphere_integral((mu) => hg_phase(mu, g))).toBeCloseTo(1, 2)
    }
  })

  test('g=0 is isotropic (1/4π everywhere)', () => {
    for (const mu of [-1, -0.5, 0, 0.5, 1]) {
      expect(hg_phase(mu, 0)).toBeCloseTo(1 / FOUR_PI, 9)
    }
  })

  test('forward-peaked: p(→sun) ≫ p(away) for g>0, and the ratio grows with g', () => {
    let prev_ratio = 1
    for (const g of [0.2, 0.5, 0.65, 0.8]) {
      const fwd = hg_phase(1, g)
      const back = hg_phase(-1, g)
      expect(fwd).toBeGreaterThan(back)
      const ratio = fwd / back
      expect(ratio).toBeGreaterThan(prev_ratio)
      prev_ratio = ratio
    }
    // g=0.65 default: a steep forward bias (this is what makes "look away → shaft gone" work).
    expect(hg_phase(1, 0.65) / hg_phase(0, 0.65)).toBeGreaterThan(15)
  })

  test('monotonically increases toward the sun (cos_theta ↑ ⇒ phase ↑) for g>0', () => {
    let prev = -Infinity
    for (let mu = -1; mu <= 1; mu += 0.05) {
      const v = hg_phase(mu, 0.65)
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12)
      prev = v
    }
  })

  test('finite and positive everywhere (guarded denominator, no divide-by-zero at g→1)', () => {
    for (const g of [0.9, 0.99, 0.999]) {
      for (const mu of [-1, 0, 1]) {
        const v = hg_phase(mu, g)
        expect(Number.isFinite(v)).toBe(true)
        expect(v).toBeGreaterThan(0)
      }
    }
  })
})

describe('height_density — near-ground falloff', () => {
  const { density: D0, ground_y: GY, falloff_h: H } = GODRAYS_DEFAULTS

  test('full density at and below the ground plane', () => {
    expect(height_density(GY, D0, GY, H)).toBeCloseTo(D0, 12)
    expect(height_density(GY - 50, D0, GY, H)).toBeCloseTo(D0, 12)
  })

  test('e-folds every falloff_h metres above ground', () => {
    expect(height_density(GY + H, D0, GY, H)).toBeCloseTo(D0 / Math.E, 9)
    expect(height_density(GY + 2 * H, D0, GY, H)).toBeCloseTo(D0 / (Math.E * Math.E), 9)
  })

  test('monotonically non-increasing with altitude, never negative', () => {
    let prev = Infinity
    for (let y = GY - 10; y <= GY + 200; y += 2) {
      const v = height_density(y, D0, GY, H)
      expect(v).toBeLessThanOrEqual(prev + 1e-12)
      expect(v).toBeGreaterThanOrEqual(0)
      prev = v
    }
  })

  test('uses the module defaults when args omitted', () => {
    expect(height_density(GY)).toBeCloseTo(D0, 12)
  })
})

/** Build N homogeneous segments of constant σ over distance `dist`, each with visibility `lit`.
 *  @param {number} sigma @param {number} lit @param {number} dist @param {number} n
 *  @returns {{segs:{sigma:number,lit:number}[], dt:number}} */
function const_path(sigma, lit, dist, n) {
  const segs = []
  for (let i = 0; i < n; i++) segs.push({ sigma, lit })
  return { segs, dt: dist / n }
}

/** Independent RTE reference: fine Euler march of dL = σ·lit·T·dt, T·=e^{−σ·dt} over the SAME segments
 *  sub-stepped `micro`× — converges to integrate_inscatter as micro→∞ (the froxels.test brute pattern).
 *  @param {{sigma:number,lit:number}[]} segments @param {number} dt @param {number} micro
 *  @returns {{L:number, T:number}} */
function brute_inscatter(segments, dt, micro) {
  let T = 1
  let L = 0
  for (const s of segments) {
    const sigma = Math.max(0, s.sigma)
    const lit = s.lit < 0 ? 0 : s.lit > 1 ? 1 : s.lit
    const sub = dt / micro
    const step_t = Math.exp(-sigma * sub)
    for (let m = 0; m < micro; m++) {
      L += sigma * lit * T * sub
      T *= step_t
    }
  }
  return { L, T }
}

describe('integrate_inscatter — front-to-back single scatter', () => {
  test('transmittance is exactly exp(−Σ σ·dt), independent of lit', () => {
    const { segs, dt } = const_path(0.03, 0.4, 160, 40)
    const sum = segs.reduce((a, s) => a + s.sigma * dt, 0)
    expect(integrate_inscatter(segs, dt).T).toBeCloseTo(Math.exp(-sum), 10)
  })

  test('converges to the closed-form 1−exp(−σD) for a fully-lit constant path', () => {
    const sigma = 0.03
    const D = 160
    const { segs, dt } = const_path(sigma, 1, D, 48)
    const closed = 1 - Math.exp(-sigma * D)
    // 48-step midpoint sum is already within ~1% of the analytic integral; the brute march confirms it.
    expect(integrate_inscatter(segs, dt).L).toBeCloseTo(closed, 2)
    const fine = const_path(sigma, 1, D, 4000)
    expect(integrate_inscatter(fine.segs, fine.dt).L).toBeCloseTo(closed, 4)
  })

  test('matches a fine Euler RTE march (L and T) within tolerance', () => {
    // a mixed lit/shadow path (a shaft band inside otherwise-shadowed air).
    const segs = []
    for (let i = 0; i < 64; i++) segs.push({ sigma: 0.01 + (i % 7) * 0.004, lit: i >= 20 && i < 40 ? 1 : 0 })
    const dt = 3
    const closed = integrate_inscatter(segs, dt)
    const brute = brute_inscatter(segs, dt, 2000)
    expect(closed.T).toBeCloseTo(brute.T, 6) // transmittance is the same exp(−Σσ·dt) either way
    expect(closed.L).toBeCloseTo(brute.L, 2) // 64-step midpoint vs 128k-step march agree to 2 s.f.
  })

  test('a fully-shadowed path scatters nothing but still extincts (the cave-dark guarantee)', () => {
    const { segs, dt } = const_path(0.05, 0, 100, 50)
    const r = integrate_inscatter(segs, dt)
    expect(r.L).toBe(0)
    expect(r.T).toBeCloseTo(Math.exp(-0.05 * 100), 10)
  })

  test('front segments contribute more than identical back segments (attenuation ordering)', () => {
    const one = { sigma: 0.03, lit: 1 }
    const first = integrate_inscatter([one], 12)
    const both = integrate_inscatter([one, one], 12)
    const second = both.L - first.L
    expect(first.L).toBeGreaterThan(second)
    expect(second).toBeGreaterThan(0)
  })

  test('empty column and σ→0 are NaN-free', () => {
    expect(integrate_inscatter([], 4)).toEqual({ L: 0, T: 1 })
    const r = integrate_inscatter([{ sigma: 0, lit: 1 }], 5)
    expect(Number.isFinite(r.L)).toBe(true)
    expect(Number.isFinite(r.T)).toBe(true)
  })

  test('lit visibility is clamped to [0,1] (no energy from out-of-range gates)', () => {
    const hi = integrate_inscatter([{ sigma: 0.03, lit: 5 }], 10).L
    const clamped = integrate_inscatter([{ sigma: 0.03, lit: 1 }], 10).L
    expect(hi).toBeCloseTo(clamped, 12)
    expect(integrate_inscatter([{ sigma: 0.03, lit: -2 }], 10).L).toBe(0)
  })
})

// ── THE ACCEPTANCE BEHAVIORS, at the math level (the shader realises the same numbers on-GPU) ──────────
// Final in-scatter luma along a ray = integrate_inscatter(σ(y), lit).L × hg_phase(cos_theta) × strength.
// (Sun colour is a per-channel multiply that factors out; use unit luma here.)
/**
 * @param {{ cam_y:number, rd_y:number, cos_theta:number, lit:(t:number)=>number, dist?:number, steps?:number }} ray
 * @returns {number} final in-scatter radiance luma (pre sun-colour)
 */
function ray_radiance(ray) {
  const D = GODRAYS_DEFAULTS
  const dist = ray.dist ?? D.max_dist
  const steps = ray.steps ?? D.steps
  const dt = dist / steps
  const segs = []
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) * dt
    const y = ray.cam_y + ray.rd_y * t
    segs.push({ sigma: height_density(y), lit: ray.lit(t) })
  }
  const { L } = integrate_inscatter(segs, dt)
  return L * hg_phase(ray.cos_theta, D.g) * D.strength
}

describe('non-washout + contrast (the probe proves these in pixels)', () => {
  const LIT_ALL = () => 1
  const SHADOWED = () => 0

  test('ACCEPTANCE 3 — an OPEN, off-sun clearing adds a near-zero veil', () => {
    // level view over open ground, sun ~90° off-axis: every sample lit, but the phase is tiny.
    const veil = ray_radiance({ cam_y: 2, rd_y: 0, cos_theta: 0, lit: LIT_ALL })
    expect(veil).toBeLessThan(0.005) // effectively invisible in HDR before tonemap
  })

  test('an upward open view fades even faster (height falloff leaves the haze layer)', () => {
    const level = ray_radiance({ cam_y: 2, rd_y: 0, cos_theta: 0, lit: LIT_ALL })
    const upward = ray_radiance({ cam_y: 2, rd_y: 0.7, cos_theta: 0, lit: LIT_ALL })
    expect(upward).toBeLessThan(level)
  })

  test('ACCEPTANCE 1 — a SUNWARD lit shaft is many× brighter than the same path off-sun', () => {
    const off_sun = ray_radiance({ cam_y: 2, rd_y: 0, cos_theta: 0, lit: LIT_ALL })
    const sunward = ray_radiance({ cam_y: 2, rd_y: 0.2, cos_theta: 0.95, lit: LIT_ALL })
    expect(sunward / off_sun).toBeGreaterThan(10) // the shaft pops toward the sun
  })

  test('ACCEPTANCE 2 — turning AWAY from the sun collapses the same lit shaft', () => {
    const toward = ray_radiance({ cam_y: 2, rd_y: 0.2, cos_theta: 0.95, lit: LIT_ALL })
    const away = ray_radiance({ cam_y: 2, rd_y: 0.2, cos_theta: -0.95, lit: LIT_ALL })
    expect(away / toward).toBeLessThan(0.05) // phase kills the backward view
  })

  test('the shadow gate zeroes a cave even looking straight at the sun', () => {
    const lit_shaft = ray_radiance({ cam_y: 2, rd_y: 0.2, cos_theta: 0.95, lit: LIT_ALL })
    const shadowed = ray_radiance({ cam_y: 2, rd_y: 0.2, cos_theta: 0.95, lit: SHADOWED })
    expect(shadowed).toBe(0)
    expect(lit_shaft).toBeGreaterThan(0)
  })
})
