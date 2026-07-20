// Pure-math tests for the froxel integrator — the load-bearing correctness claim of NG2-F. The
// shipped closed-form front-to-back integral `integrate_slices` is pinned against an INDEPENDENT
// brute-force radiative-transfer reference (fine Euler sub-stepping of dL=S·T·dt, T·=e^(−σ·dt)),
// plus the exp-slice distance mapping and its inverse (the `apply` depth→slice lookup). GPU-pass
// behavior is the wiring wave's concern.

import { test, expect, describe } from 'bun:test'

import { FAR, FROXEL_TIERS, FX, FY, FZ, NEAR, depth_to_slice_w, integrate_slices, slice_dist } from './froxels.js'

/**
 * Independent reference: fine Euler march of the RTE across the SAME homogeneous slices. Converges
 * to the closed-form as `micro`→∞. `scatter = source·σ`, so dL = (scatter/σ)·σ·T·dt = scatter·T·dt.
 * @param {import('./froxels.js').FroxelSlice[]} slices @param {number} micro sub-steps per slice
 * @returns {{ L:[number,number,number], T:number }}
 */
function brute_integrate(slices, micro) {
  let T = 1
  const L = [0, 0, 0]
  for (const s of slices) {
    const sigma = Math.max(s.sigma, 1e-6)
    const dt = s.dz / micro
    const step_t = Math.exp(-sigma * dt)
    for (let m = 0; m < micro; m++) {
      for (let c = 0; c < 3; c++) L[c] += s.scatter[c] * T * dt
      T *= step_t
    }
  }
  return { L: /** @type {[number,number,number]} */ (L), T }
}

/** deterministic pseudo-random slice grid. @param {number} n @returns {import('./froxels.js').FroxelSlice[]} */
function make_slices(n) {
  /** @type {import('./froxels.js').FroxelSlice[]} */
  const out = []
  let s = 0x2545f491
  const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296
  for (let i = 0; i < n; i++) {
    out.push({
      scatter: [rnd() * 2, rnd() * 1.5, rnd()],
      sigma: 0.002 + rnd() * 0.05,
      dz: 1 + rnd() * 18,
    })
  }
  return out
}

describe('exp-slice distance mapping', () => {
  test('endpoints: slice_dist(0)=NEAR, slice_dist(1)=FAR', () => {
    expect(slice_dist(0)).toBeCloseTo(NEAR, 9)
    expect(slice_dist(1)).toBeCloseTo(FAR, 9)
  })

  test('monotonically increasing', () => {
    let prev = -1
    for (let u = 0; u <= 1; u += 0.05) {
      const d = slice_dist(u)
      expect(d).toBeGreaterThan(prev)
      prev = d
    }
  })

  test('depth_to_slice_w is the exact inverse of slice_dist', () => {
    for (let u = 0; u <= 1; u += 0.05) {
      expect(depth_to_slice_w(slice_dist(u))).toBeCloseTo(u, 9)
    }
  })

  test('depth mapping clamps outside [NEAR,FAR]', () => {
    expect(depth_to_slice_w(NEAR * 0.5)).toBe(0)
    expect(depth_to_slice_w(FAR * 10)).toBe(1)
  })
})

describe('integrate_slices — closed form vs brute-force RTE', () => {
  test('matches a fine Euler march (L and T) within tolerance', () => {
    const slices = make_slices(64)
    const closed = integrate_slices(slices)
    const brute = brute_integrate(slices, 4096)
    expect(closed.T).toBeCloseTo(brute.T, 4)
    for (let c = 0; c < 3; c++) {
      expect(closed.L[c]).toBeCloseTo(brute.L[c], 2)
      // relative agreement too (values are O(1..100))
      expect(Math.abs(closed.L[c] - brute.L[c]) / (Math.abs(brute.L[c]) + 1e-6)).toBeLessThan(3e-3)
    }
  })

  test('transmittance equals exp(−Σ σ·dz) exactly (independent of scatter)', () => {
    const slices = make_slices(40)
    const sum = slices.reduce((a, s) => a + Math.max(s.sigma, 1e-6) * s.dz, 0)
    expect(integrate_slices(slices).T).toBeCloseTo(Math.exp(-sum), 10)
  })

  test('front slices contribute more than identical back slices (attenuation)', () => {
    /** @type {import('./froxels.js').FroxelSlice} */
    const one = { scatter: [1, 1, 1], sigma: 0.03, dz: 12 }
    const first = integrate_slices([one])
    const both = integrate_slices([one, one])
    const second_contrib = both.L[0] - first.L[0]
    expect(first.L[0]).toBeGreaterThan(second_contrib)
    expect(second_contrib).toBeGreaterThan(0)
  })

  test('empty column: no radiance, full transmittance; no NaN on σ→0', () => {
    expect(integrate_slices([])).toEqual({ L: [0, 0, 0], T: 1 })
    const r = integrate_slices([{ scatter: [1, 1, 1], sigma: 0, dz: 5 }])
    for (const v of r.L) expect(Number.isFinite(v)).toBe(true)
    expect(Number.isFinite(r.T)).toBe(true)
  })
})

describe('tier knobs', () => {
  test('high matches the 192×108×96 ceiling reference (ultra→high collapse, S-85)', () => {
    expect(FROXEL_TIERS.high).toEqual({ fx: FX, fy: FY, fz: FZ })
    expect([FX, FY, FZ]).toEqual([192, 108, 96])
  })
})
