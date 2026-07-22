// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// D164-B pure-math unit tests for the leaf-realism wave's two tested twins — no GPU, no TSL evaluation
// (same discipline as terrain_tint.test.js's straw_tip_ratio and terrain_material.test.js's winding math):
//   • leaf_tilt_angle  — the per-plane PITCH the cutout vertex applies (terrain_flora.js). The KEY property
//     is the GRASS GATE: max=0 ⇒ the angle is EXACTLY 0 for every hash, so grass planes stay vertical and
//     the grass vertex graph is byte-identical (the material passes tilt 0 for foliage, LEAF_TILT_MAX for
//     cutout). Plus the cutout band is exactly [−max, +max], centred (0 at h=0.5).
//   • canopy_variety_offsets — the per-TREE / per-PATCH hue+value the material composes onto the per-plane
//     jitter (terrain_leaf.js). NEUTRAL at h=0.5 (hue 0, value 1 ⇒ no shift), symmetric band ±HUE_AMP rad /
//     1±VAL_AMP, monotone in the hash — so neighbouring buckets read as distinct individuals, bounded.

import { test, expect, describe } from 'bun:test'

import { BLOCK_REGISTRY } from '../config/block_registry.js'

import {
  foliage_cull_margin,
  leaf_tilt_angle,
  LEAF_TILT_MAX,
  pair_cross_angle,
  LEAF_CROSS_JITTER,
} from './terrain_flora.js'
import { canopy_variety_offsets, CANOPY_VARIETY } from './terrain_leaf.js'

describe('foliage_cull_margin (shader-displaced grass envelope)', () => {
  test('covers every foliage block and is the smallest integer margin that does', () => {
    // Pure-JS mirror of the shipped MEDIUM/HIGH grass vertex maxima in terrain_flora.js and its caller:
    // width 1.6, scale spread 1.75, height scale 1.6, lean ±0.14, sway 0.07/block, base dy ≤ 0.08.
    const half_width = (1.6 * (1 + 0.3 * 1.75)) / 2
    let max_overreach = 0
    for (const block of BLOCK_REGISTRY.filter((entry) => entry.class === 'foliage')) {
      const cross_height = block.cross_height ?? 1
      const vertical_overreach = 0.08 + cross_height * 1.6 * Math.cos(0.14) + half_width * Math.sin(0.14) - 1
      const horizontal_overreach = half_width + cross_height * 1.6 * Math.sin(0.14) + cross_height * 0.07
      max_overreach = Math.max(max_overreach, vertical_overreach, horizontal_overreach)
      expect(vertical_overreach).toBeLessThanOrEqual(foliage_cull_margin)
      expect(horizontal_overreach).toBeLessThanOrEqual(foliage_cull_margin)
    }
    expect(Math.ceil(max_overreach)).toBe(foliage_cull_margin)
  })
})

describe('leaf_tilt_angle (per-plane pitch; grass gate)', () => {
  test('GRASS GATE: max=0 ⇒ angle is exactly 0 for every hash (vertical, byte-identical)', () => {
    // `+ 0` normalizes JS −0 (from `·2·0`) to +0 — the SHADER treats −0.0 == 0.0, so the vertical gate holds.
    for (const h of [0, 0.13, 0.37, 0.5, 0.62, 0.88, 1]) expect(leaf_tilt_angle(h, 0) + 0).toBe(0)
  })

  test('centred at h=0.5 (no pitch) and spans exactly [−max, +max] at the hash extremes', () => {
    expect(leaf_tilt_angle(0.5)).toBeCloseTo(0, 12)
    expect(leaf_tilt_angle(0)).toBeCloseTo(-LEAF_TILT_MAX, 12)
    expect(leaf_tilt_angle(1)).toBeCloseTo(LEAF_TILT_MAX, 12)
  })

  test('stays within ±max across the hash and is monotone increasing', () => {
    let prev = -Infinity
    for (let i = 0; i <= 20; i += 1) {
      const a = leaf_tilt_angle(i / 20)
      expect(Math.abs(a)).toBeLessThanOrEqual(LEAF_TILT_MAX + 1e-9)
      expect(a).toBeGreaterThan(prev)
      prev = a
    }
  })

  test('LEAF_TILT_MAX is in the demanded ±0.55–0.65 rad band (D177: RIGID rotation — the ±1.1 up-axis-only lean sheared planes into parallelograms)', () => {
    expect(LEAF_TILT_MAX).toBeGreaterThanOrEqual(0.55)
    expect(LEAF_TILT_MAX).toBeLessThanOrEqual(0.65)
  })
})

describe('pair_cross_angle (round-2 — crossed planes symptom, the de-rigidified X)', () => {
  test('GRASS GATE: jitter=0 ⇒ EXACTLY π/2 for every hash (the frozen X — grass vertex graph byte-identical)', () => {
    for (const h of [0, 0.21, 0.5, 0.77, 1]) expect(pair_cross_angle(h, 0)).toBe(Math.PI / 2)
  })

  test('cutout: centred on 90° at h=0.5, spans exactly 90°±LEAF_CROSS_JITTER at the extremes', () => {
    expect(pair_cross_angle(0.5)).toBeCloseTo(Math.PI / 2, 12)
    expect(pair_cross_angle(0)).toBeCloseTo(Math.PI / 2 - LEAF_CROSS_JITTER, 12)
    expect(pair_cross_angle(1)).toBeCloseTo(Math.PI / 2 + LEAF_CROSS_JITTER, 12)
  })

  test('planes NEVER collapse near-parallel: the crossing angle keeps ≥ ~56° separation at every hash', () => {
    // A pair meeting under ~30° reads as one flat card — the whole point of the X dies. The jitter
    // amplitude must keep the worst-case separation comfortably angular.
    for (let i = 0; i <= 40; i += 1) {
      const a = pair_cross_angle(i / 40)
      expect(a).toBeGreaterThan(Math.PI / 6) // > 30° from parallel...
      expect(a).toBeLessThan((Math.PI * 5) / 6) // ...on both sides
    }
    expect(Math.PI / 2 - LEAF_CROSS_JITTER).toBeGreaterThanOrEqual(0.97) // ≥ ~56°
  })
})

describe('canopy_variety_offsets (per-tree / per-patch green variety)', () => {
  test('NEUTRAL at h=0.5: zero hue rotation and a 1.0 value multiply (no shift)', () => {
    const { hue, value_mul } = canopy_variety_offsets(0.5, 0.5)
    expect(hue).toBeCloseTo(0, 12)
    expect(value_mul).toBeCloseTo(1, 12)
  })

  test('spans exactly ±HUE_AMP rad and 1±VAL_AMP at the hash extremes', () => {
    const lo = canopy_variety_offsets(0, 0)
    const hi = canopy_variety_offsets(1, 1)
    expect(lo.hue).toBeCloseTo(-CANOPY_VARIETY.HUE_AMP, 12)
    expect(hi.hue).toBeCloseTo(CANOPY_VARIETY.HUE_AMP, 12)
    expect(lo.value_mul).toBeCloseTo(1 - CANOPY_VARIETY.VAL_AMP, 12)
    expect(hi.value_mul).toBeCloseTo(1 + CANOPY_VARIETY.VAL_AMP, 12)
  })

  test('hue + value stay bounded and monotone across the hash range', () => {
    let ph = -Infinity
    let pv = -Infinity
    for (let i = 0; i <= 20; i += 1) {
      const { hue, value_mul } = canopy_variety_offsets(i / 20, i / 20)
      expect(Math.abs(hue)).toBeLessThanOrEqual(CANOPY_VARIETY.HUE_AMP + 1e-9)
      expect(value_mul).toBeGreaterThanOrEqual(1 - CANOPY_VARIETY.VAL_AMP - 1e-9)
      expect(value_mul).toBeLessThanOrEqual(1 + CANOPY_VARIETY.VAL_AMP + 1e-9)
      expect(hue).toBeGreaterThan(ph)
      expect(value_mul).toBeGreaterThan(pv)
      ph = hue
      pv = value_mul
    }
  })

  test('amplitudes match the brief (round-3: hue ±0.13, value ±16% — "no variation in color")', () => {
    expect(CANOPY_VARIETY.HUE_AMP).toBeCloseTo(0.13, 5)
    expect(CANOPY_VARIETY.VAL_AMP).toBeCloseTo(0.16, 5)
  })
})
