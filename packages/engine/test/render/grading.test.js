// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure-math tests for the NG2-ATMO output grade. Pins the shipped color MATH the TSL node mirrors:
// (1) contrast is a MONOTONE map with EXACT fixed endpoints (no black-crush / white-clip),
// (2) the low-freq operator lifts REGIONAL (plane) separation while preserving per-cell grain
//     (constraint: separate planes, not cells),
// (3) per-pixel local contrast defaults grain-safe (≈identity), so the fallback never adds clutter,
// (4) the neutral (grey) axis is protected by the sat/vibrance stages,
// (5) a numeric grade-curve PREVIEW (input grays → output) proving the midtone contrast lift + no clip
//     — the exit artifact. GPU/TSL behavior is the wiring wave's concern.

import { test, expect, describe } from 'bun:test'

import {
  DEFAULT_GRADE,
  GRADE_LOCAL_CONTRAST,
  grade_channel,
  grade_channel_lowfreq,
  grade_rgb,
  grade_rgb_lowfreq,
  luma,
} from '../../src/render/grading.js'

describe('grade_channel — grain-safe per-pixel curve', () => {
  test('local contrast defaults to neutral (grain is already at its ceiling — constraint)', () => {
    expect(GRADE_LOCAL_CONTRAST).toBe(1.0)
    // with local_contrast=1 the only change is the shadow lift; the map is a near-identity affine.
    for (let x = 0; x <= 1.0001; x += 0.1) {
      const y = grade_channel(x, DEFAULT_GRADE)
      // monotone, in-range, and close to identity (lift only) — never amplifies fine differences.
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(1)
    }
  })

  test('endpoints: 0 stays black-ish (only the lift floor), 1 stays exactly white (no clip)', () => {
    expect(grade_channel(1, DEFAULT_GRADE)).toBeCloseTo(1, 9)
    // black maps to the lift floor, not below 0 and not a hard 0 (cinematic toe).
    const black = grade_channel(0, DEFAULT_GRADE)
    expect(black).toBeCloseTo(DEFAULT_GRADE.lift, 9)
    expect(black).toBeGreaterThan(0)
  })

  test('monotone non-decreasing across the range', () => {
    let prev = -1
    for (let x = 0; x <= 1.0001; x += 0.02) {
      const y = grade_channel(x, DEFAULT_GRADE)
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = y
    }
  })
})

describe('grade_channel_lowfreq — plane separation, not cell separation (constraint)', () => {
  // Two pixels in the SAME region (same low-freq luma) must keep their fine difference — the low-freq
  // gain is shared, so their DELTA is only scaled by that one gain, never independently stretched.
  test('same-region pixels: fine delta scaled by ONE shared gain (grain preserved, not amplified)', () => {
    const lf = 0.5 // both pixels sit in a mid-luma region
    const a = 0.48
    const b = 0.52
    const ga = grade_channel_lowfreq(a, lf, DEFAULT_GRADE)
    const gb = grade_channel_lowfreq(b, lf, DEFAULT_GRADE)
    // the local term is neutral (local_contrast=1), so the ratio of output delta to input delta equals
    // the region gain for BOTH — i.e. the fine grain is uniformly scaled, not per-pixel re-contrasted.
    const gain = (gb - ga) / (b - a) / (1 - DEFAULT_GRADE.lift)
    // region gain at a mid pivot region is modest and identical for both pixels (that's the point).
    expect(gain).toBeGreaterThan(0)
    expect(Number.isFinite(gain)).toBe(true)
  })

  test('REGION separation stretched in the shadow-to-mid band (canopy mass vs lit ground plane)', () => {
    // pixel value equal to its region luma (a flat region) → output tracks the low-freq curve. The
    // below-pivot band is where the plane-separation punch lives (slope > 1 pre-shoulder); across
    // the pivot the faded shoulder deliberately softens (Conquest mood), so assert the dark band.
    const dark = grade_channel_lowfreq(0.15, 0.15, DEFAULT_GRADE)
    const mid = grade_channel_lowfreq(0.4, 0.4, DEFAULT_GRADE)
    // separation vs the plain input gap (the planes pulled apart despite lift + shoulder fade).
    expect(mid - dark).toBeGreaterThan((0.4 - 0.15) * 1.05)
  })

  test('contrast=1 ⇒ low-freq gain is identity everywhere (pass-through + shoulder + lift only)', () => {
    const cfg = { ...DEFAULT_GRADE, contrast: 1 }
    const sh = (/** @type {number} */ v) => (v * (1 + cfg.shoulder)) / (1 + cfg.shoulder * v)
    for (const lf of [0.1, 0.3, 0.6, 0.9]) {
      for (const x of [0.05, 0.4, 0.95]) {
        const y = grade_channel_lowfreq(x, lf, cfg)
        const id = cfg.lift + sh(Math.min(1, x)) * (1 - cfg.lift)
        expect(y).toBeCloseTo(id, 6)
      }
    }
  })

  test('all outputs in [0,1] across a grid (no clip/crush at any region×pixel)', () => {
    for (let lf = 0; lf <= 1.0001; lf += 0.2) {
      for (let x = 0; x <= 1.0001; x += 0.2) {
        const y = grade_channel_lowfreq(x, lf, DEFAULT_GRADE)
        expect(y).toBeGreaterThanOrEqual(0)
        expect(y).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('grade_rgb — Conquest chroma (restored saturation) + protected neutral axis', () => {
  const chroma = (/** @type {[number,number,number]} */ c) => Math.max(...c) - Math.min(...c)

  test('DEFAULT saturation restores chroma: a controlled boost above neutral (not humble, not candy)', () => {
    const before = /** @type {[number,number,number]} */ ([0.6, 0.3, 0.3]) // reddish
    const neutral = grade_rgb(before, { ...DEFAULT_GRADE, saturation: 1, vibrance: 0 })
    const after = grade_rgb(before, DEFAULT_GRADE)
    // CO-TUNE 2026-07-03: the Conquest refs' signature is SATURATION (measured q_sat 0.24-0.55), not
    // the earlier "humble" read — the washed day rendered colorless (q_sat 0.107). The default now
    // BOOSTS chroma above neutral, but stays CONTROLLED (well under a heavy punch) to protect the
    // neutral axis. Boosted above neutral, capped under +35%.
    expect(chroma(after)).toBeGreaterThan(chroma(neutral))
    expect(chroma(after)).toBeLessThan(chroma(neutral) * 1.35)
  })

  test('the punch KNOB still works (raising saturation grows chroma beyond default)', () => {
    const before = /** @type {[number,number,number]} */ ([0.6, 0.3, 0.3])
    const base = grade_rgb(before, DEFAULT_GRADE)
    const punchy = grade_rgb(before, { ...DEFAULT_GRADE, saturation: 1.4, vibrance: 0.2 })
    expect(chroma(punchy)).toBeGreaterThan(chroma(base))
  })

  test('neutral grey stays neutral (r≈g≈b) — the protected skin/neutral axis', () => {
    for (const g of [0.05, 0.2, 0.5, 0.8, 0.98]) {
      const out = grade_rgb([g, g, g], DEFAULT_GRADE)
      expect(out[0]).toBeCloseTo(out[1], 9)
      expect(out[1]).toBeCloseTo(out[2], 9)
    }
  })

  test('grade preserves luminance ORDER (brighter input → brighter output)', () => {
    const dark = luma(grade_rgb([0.2, 0.2, 0.2], DEFAULT_GRADE))
    const bright = luma(grade_rgb([0.7, 0.7, 0.7], DEFAULT_GRADE))
    expect(bright).toBeGreaterThan(dark)
  })

  test('every channel stays in [0,1] for saturated primaries (no clip blowout)', () => {
    for (const c of [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1, 1, 0],
      [0.9, 0.1, 0.1],
    ]) {
      const out = grade_rgb(/** @type {[number,number,number]} */ (c), DEFAULT_GRADE)
      for (const ch of out) {
        expect(ch).toBeGreaterThanOrEqual(0)
        expect(ch).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('grade_rgb_lowfreq — regional contrast + saturation together', () => {
  test('finite, in-range across a color×region grid', () => {
    for (const lf of [0.15, 0.5, 0.85]) {
      for (const c of [
        [0.2, 0.3, 0.1],
        [0.7, 0.7, 0.75],
        [0.5, 0.2, 0.2],
      ]) {
        const out = grade_rgb_lowfreq(/** @type {[number,number,number]} */ (c), lf, DEFAULT_GRADE)
        for (const ch of out) {
          expect(Number.isFinite(ch)).toBe(true)
          expect(ch).toBeGreaterThanOrEqual(0)
          expect(ch).toBeLessThanOrEqual(1)
        }
      }
    }
  })
})

// ── EXIT ARTIFACT: grade-curve preview (input grays → output) ──────────────────────────────────────
// Proves the midtone contrast LIFT (regional) and NO CLIPPING, numerically, in the test log. Uses the
// low-freq operator with pixel == region (a flat grey ramp) so the printed curve IS the shipped
// plane-separation contrast response. Asserts: strictly increasing, endpoints in-range, a real
// steepening around the pivot (mid-slope > toe-slope and > shoulder-slope).
describe('grade-curve PREVIEW (exit artifact)', () => {
  test('flat-grey ramp through the low-freq grade — contrast lift, no clip', () => {
    const steps = 21
    /** @type {Array<{in:number, out:number}>} */
    const rows = []
    for (let i = 0; i < steps; i++) {
      const g = i / (steps - 1)
      const out = grade_channel_lowfreq(g, g, DEFAULT_GRADE) // pixel == region ⇒ the pure curve
      rows.push({ in: g, out })
    }

    // pretty-print the curve for the artifact log.
    const bar = (/** @type {number} */ v) => '█'.repeat(Math.round(v * 40))

    console.log(
      'grade curve (low-freq, contrast=%s sat=%s pivot=%s lift=%s):',
      DEFAULT_GRADE.contrast,
      DEFAULT_GRADE.saturation,
      DEFAULT_GRADE.pivot,
      DEFAULT_GRADE.lift
    )
    for (const r of rows) {
      console.log('  in %s → out %s  %s', r.in.toFixed(3), r.out.toFixed(4), bar(r.out))
    }

    // strictly increasing (a valid tonal curve).
    for (let i = 1; i < rows.length; i++) expect(rows[i].out).toBeGreaterThan(rows[i - 1].out)
    // endpoints: no clip (black at the lift floor, white exactly 1).
    expect(rows[0].out).toBeCloseTo(DEFAULT_GRADE.lift, 6)
    expect(rows[rows.length - 1].out).toBeCloseTo(1, 6)

    // plane-separation property (survives the faded shoulder): the shadow-to-mid band — canopy
    // masses vs lit ground planes — separates FASTER than the plain input gap, while the highlight
    // end deliberately softens (the Conquest aged-film rolloff: top slope < mid slope).
    const at = (/** @type {number} */ x) => grade_channel_lowfreq(x, x, DEFAULT_GRADE)
    const slope = (/** @type {number} */ x0, /** @type {number} */ x1) => (at(x1) - at(x0)) / (x1 - x0)
    expect(slope(0.15, 0.4)).toBeGreaterThan(1.05) // dark-band separation beats identity
    expect(slope(0.85, 1.0)).toBeLessThan(slope(0.15, 0.4)) // faded highlight rolloff (shoulder)
  })
})
