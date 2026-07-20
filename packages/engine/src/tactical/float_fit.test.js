// RED-FIRST (regression: "TACKLED badge oversized+cropped"): the TACKLED status floater — e.g. the composed
// "TACKLED  -2 MP  -1 AP" tag — is far wider than a damage number, yet the float sprite rasterizes into a
// FIXED-width canvas. At the base font a long tag overflows and CLIPS. fit_float_font_px is the shrink-to-fit
// law (the board's toast-width-cap applied to floats): a string that already fits keeps the base size; a wider
// one scales down by the exact overflow ratio so it NEVER clips (the supersampled canvas keeps it crisp).
import { describe, expect, test } from 'bun:test'

import { fit_float_font_px } from './board_entities.js'

// JetBrains Mono advance ≈ 0.6em, so at the 38px base a glyph is ~22.8px wide (canvas-free approximation).
const BASE_PX = 38
const AVAIL_PX = 256 - 12 * 2 // the float canvas width minus the per-side breathing pad
const mono_width = (/** @type {number} */ chars, /** @type {number} */ px) => chars * 0.6 * px

describe('fit_float_font_px — floats shrink-to-fit, never clip (TACKLED badge regression)', () => {
  test('a short damage number keeps the base font (no shrink)', () => {
    expect(fit_float_font_px(mono_width('-1234'.length, BASE_PX))).toBe(BASE_PX)
  })

  test('the long TACKLED status tag shrinks so it fits INSIDE the canvas (never clips)', () => {
    const text = 'TACKLED  -2 MP  -1 AP'
    const at_base = mono_width(text.length, BASE_PX)
    // documents the bug at HEAD: at the base font the tag is far wider than the canvas can hold → it clips
    expect(at_base).toBeGreaterThan(AVAIL_PX)
    const fit = fit_float_font_px(at_base)
    expect(fit).toBeLessThan(BASE_PX)
    // the shrunk font renders WITHIN the available width — the "NEVER clip" guarantee
    expect(mono_width(text.length, fit)).toBeLessThanOrEqual(AVAIL_PX)
  })

  test('the shrink floors at a legible minimum of 1px and never returns 0/NaN', () => {
    expect(fit_float_font_px(100000)).toBeGreaterThanOrEqual(1)
    expect(Number.isFinite(fit_float_font_px(100000))).toBe(true)
  })
})
