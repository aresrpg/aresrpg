// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// [D162] Far-shell CPU macro-tint tests — the parity color-source contract: the far shell tints its near
// LOD rings with the SAME per-block tint class + amplitudes as the near terrain (single-sourced from
// terrain_tint_data.js), so sand/grass read as the same material family across the seam. Covers class
// gating (water untinted, sand value-only, grass chromatic), amplitude bounds, and determinism.

import { test, expect, describe } from 'bun:test'

import { NG_TINT } from '../../src/render/terrain_tint_data.js'
import { get_block_by_name } from '../../src/config/block_registry.js'
import { far_tint_color } from '../../src/lod/far_tint.js'

const SAND = /** @type {number} */ (get_block_by_name('sand')?.id)
const GRASS = /** @type {number} */ (get_block_by_name('grass')?.id)
const WATER = /** @type {number} */ (get_block_by_name('water')?.id)

describe('far_tint_color — class gating', () => {
  test('water (tint class 0) is returned UNCHANGED — its blue is its own colour, never macro-tinted', () => {
    const rgb = /** @type {[number,number,number]} */ ([33, 87, 107])
    for (const [x, z] of /** @type {[number,number][]} */ ([
      [0, 0],
      [123, -456],
      [2000, 3000],
    ])) {
      expect(far_tint_color(WATER, x, z, rgb)).toEqual(rgb)
    }
  })

  test('unknown block id → input unchanged (no crash, no colour drift)', () => {
    const rgb = /** @type {[number,number,number]} */ ([100, 100, 100])
    expect(far_tint_color(99999, 10, 10, rgb)).toEqual(rgb)
  })
})

describe('far_tint_color — sand (mineral, value-only)', () => {
  // Sand is tint class 1 → VALUE-ONLY (no chroma K, no turf, no dirt). So the tinted colour is the base
  // scaled by a single value multiplier within [1−VAL_MINERAL, 1+VAL_MINERAL]: the HUE (channel ratios)
  // is preserved and every channel scales by the same factor. This is what keeps sand warm-tan, only
  // brightening/darkening by the macro field — never greening.
  const base = /** @type {[number,number,number]} */ ([190, 174, 138])

  test('every channel scales by the SAME value factor (hue preserved) within the mineral amplitude', () => {
    for (const [x, z] of /** @type {[number,number][]} */ ([
      [0, 0],
      [40, 40],
      [137, 913],
      [-500, 250],
    ])) {
      const out = far_tint_color(SAND, x, z, base)
      // Recover the per-channel factor; they must agree (value-only) and sit within the mineral band.
      const factors = out.map((c, i) => c / base[i])
      for (const f of factors) {
        expect(f).toBeGreaterThanOrEqual(1 - NG_TINT.VAL_MINERAL - 0.02) // +round slack
        expect(f).toBeLessThanOrEqual(1 + NG_TINT.VAL_MINERAL + 0.02)
      }
      // channels agree to within rounding (value-only ⇒ same multiplier)
      expect(Math.abs(factors[0] - factors[1])).toBeLessThan(0.03)
      expect(Math.abs(factors[1] - factors[2])).toBeLessThan(0.03)
    }
  })
})

describe('far_tint_color — grass (grass-ground, chromatic)', () => {
  const base = /** @type {[number,number,number]} */ ([107, 112, 82])

  test('grass tint MOVES the colour (climate/turf/value engaged) somewhere in the world', () => {
    let moved = false
    for (let x = 0; x < 400 && !moved; x += 7) {
      for (let z = 0; z < 400; z += 7) {
        const out = far_tint_color(GRASS, x, z, base)
        if (out[0] !== base[0] || out[1] !== base[1] || out[2] !== base[2]) moved = true
      }
    }
    expect(moved).toBe(true)
  })

  test('grass tint stays a sane colour (0..255, never NaN)', () => {
    for (let x = 0; x < 200; x += 11) {
      for (let z = 0; z < 200; z += 11) {
        const out = far_tint_color(GRASS, x, z, base)
        for (const c of out) {
          expect(Number.isFinite(c)).toBe(true)
          expect(c).toBeGreaterThanOrEqual(0)
          expect(c).toBeLessThanOrEqual(255)
        }
      }
    }
  })
})

describe('far_tint_color — determinism', () => {
  test('same (id, x, z, rgb) ⇒ identical output (twice)', () => {
    const rgb = /** @type {[number,number,number]} */ ([120, 130, 90])
    for (const [x, z] of /** @type {[number,number][]} */ ([
      [0, 0],
      [333, -777],
      [12.5, 900.25],
    ])) {
      expect(far_tint_color(GRASS, x, z, rgb)).toEqual(far_tint_color(GRASS, x, z, rgb))
    }
  })
})
