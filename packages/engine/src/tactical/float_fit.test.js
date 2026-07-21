// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST (regression: "TACKLED badge oversized+cropped"): the ORIGINAL motivating case was the pre-#239
// combined tackle floater — a composed "TACKLED  -2 MP  -1 AP" tag far wider than a damage number, rasterized
// into a FIXED-width canvas. #239's owner ruling later dropped that combined label (tackle now floats short
// separate AP/MP numbers, voxel_fight_folds.js tackle_float_payloads) but fit_float_font_px stays a general
// shrink-to-fit guarantee for ANY future long composed float text — kept here with the same string as a
// representative long-label stress case. At the base font a long tag overflows and CLIPS. fit_float_font_px is
// the shrink-to-fit law (the board's toast-width-cap applied to floats): a string that already fits keeps the
// base size; a wider one scales down by the exact overflow ratio so it NEVER clips (the supersampled canvas
// keeps it crisp).
import { describe, expect, test } from 'bun:test'

import { SENSHI_MALE_GLB_AVAILABLE } from '../test_helpers/glb_fixture.js'

// MISSING-ARTIFACT (#117): board_entities.js unconditionally imports create_character_avatar, which
// static-imports the absent-by-design senshi_male.glb — see test_helpers/glb_fixture.js. Guarded dynamic
// import; fit_float_font_px itself has no avatar dependency, but the module can't load without the asset.
const { fit_float_font_px } = SENSHI_MALE_GLB_AVAILABLE ? await import('./board_entities.js') : {}

// JetBrains Mono advance ≈ 0.6em, so at the 38px base a glyph is ~22.8px wide (canvas-free approximation).
const BASE_PX = 38
const AVAIL_PX = 256 - 12 * 2 // the float canvas width minus the per-side breathing pad
const mono_width = (/** @type {number} */ chars, /** @type {number} */ px) => chars * 0.6 * px

describe.skipIf(!SENSHI_MALE_GLB_AVAILABLE)(
  'fit_float_font_px — floats shrink-to-fit, never clip (TACKLED badge regression)',
  () => {
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
  }
)
