// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// LEAVES-2X Rung 2 band math — the pure JS mirror of the vertex-collapse crossfade (leaf_band.js). Pins
// the invariants the TSL vertex stage relies on: full sprites near, full cubes far, a strict crossfade
// (keeps sum to 1) so the canopy silhouette is continuous across the seam, and a degenerate (keep === 0)
// representation OUTSIDE its band so it emits zero fragments (the free-cull the whole 2× rests on).

import { describe, expect, test } from 'bun:test'

import {
  LEAF_BAND_NEAR_M,
  LEAF_BAND_FAR_M,
  LEAF_BAND_NEAR_FRAC,
  LEAF_BAND_FAR_FRAC,
  leaf_band_factors,
  leaf_band_for,
  smoothstep01,
  tier_view_distance_m,
} from './leaf_band.js'

describe('leaf band crossfade (Rung 2 vertex collapse)', () => {
  test('the band is a real, ordered window', () => {
    expect(LEAF_BAND_NEAR_M).toBeGreaterThan(0)
    expect(LEAF_BAND_FAR_M).toBeGreaterThan(LEAF_BAND_NEAR_M)
  })

  test('near band: pure sprites, cubes fully degenerate (zero fragments)', () => {
    for (const d of [0, 10, LEAF_BAND_NEAR_M - 1, LEAF_BAND_NEAR_M]) {
      const { cube_keep, sprite_keep } = leaf_band_factors(d)
      expect(cube_keep).toBe(0) // degenerate cube → no fragments near
      expect(sprite_keep).toBe(1) // airy sprites at full size
    }
  })

  test('far band: pure opaque cubes, sprites fully degenerate (zero fragments)', () => {
    for (const d of [LEAF_BAND_FAR_M, LEAF_BAND_FAR_M + 1, 200, 5000]) {
      const { cube_keep, sprite_keep } = leaf_band_factors(d)
      expect(cube_keep).toBe(1) // opaque early-Z cube at full size far
      expect(sprite_keep).toBe(0) // degenerate sprite → no fragments far
    }
  })

  test('strict crossfade: keeps sum to 1 at every distance (continuous silhouette, no gap)', () => {
    for (let d = 0; d <= 160; d += 2) {
      const { cube_keep, sprite_keep } = leaf_band_factors(d)
      expect(cube_keep + sprite_keep).toBeCloseTo(1, 10)
      expect(cube_keep).toBeGreaterThanOrEqual(0)
      expect(sprite_keep).toBeGreaterThanOrEqual(0)
    }
  })

  test('midpoint is a balanced ~50/50 blend (smooth seam, not a hard swap)', () => {
    const mid = (LEAF_BAND_NEAR_M + LEAF_BAND_FAR_M) / 2
    const { cube_keep, sprite_keep } = leaf_band_factors(mid)
    expect(cube_keep).toBeCloseTo(0.5, 6)
    expect(sprite_keep).toBeCloseTo(0.5, 6)
  })

  test('monotonic: cubes strictly grow, sprites strictly shrink across the band', () => {
    let prev_cube = -1
    let prev_sprite = 2
    for (let d = LEAF_BAND_NEAR_M; d <= LEAF_BAND_FAR_M; d += 1) {
      const { cube_keep, sprite_keep } = leaf_band_factors(d)
      expect(cube_keep).toBeGreaterThanOrEqual(prev_cube)
      expect(sprite_keep).toBeLessThanOrEqual(prev_sprite)
      prev_cube = cube_keep
      prev_sprite = sprite_keep
    }
  })

  test('parametrized band: leaf_band_factors honors a custom near/far (the tier band the pool threads)', () => {
    // A wide HIGH-ish band: sprites still full at 100 m, cubes not yet started.
    expect(leaf_band_factors(100, 120, 180).sprite_keep).toBe(1)
    expect(leaf_band_factors(120, 120, 180).cube_keep).toBe(0)
    expect(leaf_band_factors(180, 120, 180).cube_keep).toBe(1)
    expect(leaf_band_factors(150, 120, 180).cube_keep).toBeCloseTo(0.5, 6) // midpoint 50/50
  })
})

describe('leaf band is TIER-DRIVEN off the voxel ring (target: "leaves fading to blocks super close")', () => {
  test('leaf_band_for derives near/far as fractions of the voxel view distance', () => {
    const view = 224 // MEDIUM r7 ring in metres
    const { near, far } = leaf_band_for(view)
    expect(near).toBeCloseTo(view * LEAF_BAND_NEAR_FRAC, 10)
    expect(far).toBeCloseTo(view * LEAF_BAND_FAR_FRAC, 10)
    expect(far).toBeGreaterThan(near)
    expect(LEAF_BAND_NEAR_FRAC).toBeLessThan(LEAF_BAND_FAR_FRAC)
    expect(LEAF_BAND_FAR_FRAC).toBeLessThan(1) // stays inside the ring (far_trees impostors own past the edge)
  })

  test('MEDIUM (the reference tier) keeps sprites well past the old "super close" 48 m onset', () => {
    // THE FIX regression lock: the medium default sprite→cube onset must sit far past where leaves were
    // watched turning to blocks (the pre-fix band started at 48 m). Do NOT let this drift back.
    expect(LEAF_BAND_NEAR_M).toBeGreaterThan(80)
    expect(tier_view_distance_m('medium')).toBe(224)
    const mid = leaf_band_for(tier_view_distance_m('medium'))
    expect(mid.near).toBeCloseTo(LEAF_BAND_NEAR_M, 10) // the exported default IS the medium band
    expect(mid.far).toBeCloseTo(LEAF_BAND_FAR_M, 10)
    // At the typical near-canopy distance (≤ ~70 m) the first layer is PURE sprites (no bare cube).
    expect(leaf_band_factors(70, mid.near, mid.far).cube_keep).toBe(0)
  })

  test('LOW keeps a CLOSE band (weak GPU) while MEDIUM/HIGH reach farther — sprite spend scales with the ring', () => {
    const low = leaf_band_for(tier_view_distance_m('low')) // r4 = 128 m
    const med = leaf_band_for(tier_view_distance_m('medium')) // r7 = 224 m
    const high = leaf_band_for(tier_view_distance_m('high')) // r8 = 256 m
    expect(low.near).toBeLessThan(med.near)
    expect(med.near).toBeLessThan(high.near)
    // LOW's band stays inside its small ring so the far half is still cheap opaque cubes (not all-sprite).
    expect(low.far).toBeLessThan(tier_view_distance_m('low'))
  })

  test('smoothstep01 matches the TSL smoothstep contract (clamped Hermite 3t²−2t³)', () => {
    expect(smoothstep01(0, 1, -1)).toBe(0)
    expect(smoothstep01(0, 1, 0)).toBe(0)
    expect(smoothstep01(0, 1, 0.5)).toBeCloseTo(0.5, 12)
    expect(smoothstep01(0, 1, 1)).toBe(1)
    expect(smoothstep01(0, 1, 2)).toBe(1)
    expect(smoothstep01(0, 1, 0.25)).toBeCloseTo(0.15625, 12) // 0.25²·(3−0.5)
  })
})
