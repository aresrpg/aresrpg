// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure-math tests for the GPU-free cloud math (`cloud_noise.js`): seed determinism of the value
// noise / fbm / bake offsets (the "cloud noise determinism from seed" requirement — the baked mx_
// weather/base volumes can't run headless, this CPU reference can) + the tier-knob contracts the
// wiring depends on.
//
// ENG-15 (2026-07-04): the per-pixel volumetric march was replaced by a FLAT cloud deck, so the
// dual-lobe HG phase / Beer–powder / perlin-worley shading-math tests were removed with the math they
// covered. What remains is the seeded noise (still the deck's coverage/base source) + the tier gate.

import { test, expect, describe } from 'bun:test'

import {
  CLOUD_TIERS,
  DEFAULT_CLOUD_SEED,
  SHADOW_EXTINCTION,
  cloud_bake_offsets,
  fbm_3d,
  hash_to_unit,
  hash_u32,
  value_noise_3d,
} from './cloud_noise.js'

describe('seeded noise determinism', () => {
  test('hash_u32 is a deterministic uint32', () => {
    for (const x of [0, 1, 42, -7, 0x7fffffff, 123456789]) {
      const a = hash_u32(x)
      expect(hash_u32(x)).toBe(a)
      expect(Number.isInteger(a)).toBe(true)
      expect(a).toBeGreaterThanOrEqual(0)
      expect(a).toBeLessThan(2 ** 32)
    }
  })

  test('value_noise_3d is identical on repeat calls (same seed+pos)', () => {
    for (const [x, y, z] of [
      [0.3, 1.7, 9.2],
      [-4.1, 2.2, 0.0],
      [100.5, -3.3, 50.9],
    ]) {
      expect(value_noise_3d(7, x, y, z)).toBe(value_noise_3d(7, x, y, z))
    }
  })

  test('different seeds produce different fields', () => {
    let diff = 0
    for (let i = 0; i < 20; i++) {
      if (value_noise_3d(1, i * 0.7, i * 0.3, i * 1.1) !== value_noise_3d(2, i * 0.7, i * 0.3, i * 1.1)) diff++
    }
    expect(diff).toBeGreaterThan(15)
  })

  test('value noise + fbm stay in [0,1]', () => {
    for (let x = -3; x < 3; x += 0.37) {
      for (let z = -3; z < 3; z += 0.41) {
        const v = value_noise_3d(9, x, 0.5, z)
        const f = fbm_3d(9, x, 0.5, z)
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
        expect(f).toBeGreaterThanOrEqual(0)
        expect(f).toBeLessThanOrEqual(1)
      }
    }
  })

  test('at integer lattice coords value noise equals the cell hash', () => {
    for (const [i, j, k] of [
      [0, 0, 0],
      [3, -2, 5],
      [-4, 7, -1],
    ]) {
      expect(value_noise_3d(11, i, j, k)).toBeCloseTo(hash_to_unit(11, i, j, k), 12)
    }
  })

  test('fbm_3d is deterministic', () => {
    expect(fbm_3d(DEFAULT_CLOUD_SEED, 1.2, 3.4, 5.6)).toBe(fbm_3d(DEFAULT_CLOUD_SEED, 1.2, 3.4, 5.6))
  })

  test('cloud_bake_offsets: deterministic, seed-sensitive, in range', () => {
    const a = cloud_bake_offsets(123)
    const b = cloud_bake_offsets(123)
    const c = cloud_bake_offsets(124)
    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
    for (const o of a) {
      expect(o).toHaveLength(3)
      for (const comp of o) {
        expect(comp).toBeGreaterThanOrEqual(0)
        expect(comp).toBeLessThan(64)
      }
    }
  })
})

describe('tier knobs (ENG-15 flat deck: bake resolutions + clouds-enabled gate)', () => {
  test('high keeps the ceiling bake resolutions (96³ base, 1024² shadow, 512² weather)', () => {
    expect(CLOUD_TIERS.high.base_res).toBe(96)
    expect(CLOUD_TIERS.high.shadow_res).toBe(1024)
    expect(CLOUD_TIERS.high.weather_res).toBe(512)
  })

  test('LOW has clouds OFF (march_steps gate = 0); every higher tier is ON', () => {
    expect(CLOUD_TIERS.low.march_steps).toBe(0)
    for (const t of ['medium', 'high']) {
      expect(CLOUD_TIERS[/** @type {keyof typeof CLOUD_TIERS} */ (t)].march_steps).toBeGreaterThan(0)
    }
  })

  test('the clouds-enabled gate is monotone across tiers (stable feature wiring)', () => {
    /** @type {Array<keyof typeof CLOUD_TIERS>} */
    const order = ['low', 'medium', 'high']
    for (let i = 1; i < order.length; i++) {
      expect(CLOUD_TIERS[order[i]].march_steps).toBeGreaterThanOrEqual(CLOUD_TIERS[order[i - 1]].march_steps)
    }
  })

  test('shadow resolution rises (or holds) with tier; high is the finest', () => {
    expect(CLOUD_TIERS.high.shadow_res).toBeGreaterThanOrEqual(CLOUD_TIERS.medium.shadow_res)
    expect(CLOUD_TIERS.medium.shadow_res).toBeGreaterThan(CLOUD_TIERS.low.shadow_res)
  })

  test('SHADOW_EXTINCTION is a sane positive coefficient', () => {
    expect(SHADOW_EXTINCTION).toBeGreaterThan(0)
    expect(SHADOW_EXTINCTION).toBeLessThan(1)
  })
})
