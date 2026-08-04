// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { test, expect, describe } from 'bun:test'

import {
  adapt_exposure,
  average_luma,
  smoothing_factor,
  create_auto_exposure,
  EXPOSURE_TARGET_LUMA,
  EXPOSURE_BASELINE,
  EXPOSURE_MIN,
  EXPOSURE_MAX,
  ADAPT_TAU_FAST,
} from '../../../src/render/lighting/auto_exposure.js'

describe('smoothing_factor', () => {
  test('0 dt ⇒ no move; large dt ⇒ nearly full', () => {
    expect(smoothing_factor(0, 1)).toBe(0)
    expect(smoothing_factor(100, 1)).toBeCloseTo(1, 5)
  })
  test('one time-constant ⇒ ~63%', () => {
    expect(smoothing_factor(1, 1)).toBeCloseTo(1 - Math.exp(-1), 5)
  })
  test('tau ≤ 0 ⇒ snap (factor 1)', () => {
    expect(smoothing_factor(0.016, 0)).toBe(1)
  })
})

describe('adapt_exposure — the servo', () => {
  const cfg = { target: 0.33, tau_fast: 0.6, tau_slow: 2.5, min: EXPOSURE_MIN, max: EXPOSURE_MAX }

  test('invalid/absent measurement ⇒ hold (clamped)', () => {
    expect(adapt_exposure(1.1, 0, 0.016, cfg)).toBe(1.1)
    expect(adapt_exposure(1.1, -1, 0.016, cfg)).toBe(1.1)
    expect(adapt_exposure(2.0, 0, 0.016, cfg)).toBe(EXPOSURE_MAX) // out-of-clamp holds AT clamp
  })

  test('too bright (measured > target) ⇒ exposure DECREASES', () => {
    const next = adapt_exposure(1.1, 0.5, 0.1, cfg)
    expect(next).toBeLessThan(1.1)
  })

  test('too dark (measured < target) ⇒ exposure INCREASES', () => {
    const next = adapt_exposure(1.1, 0.2, 0.1, cfg)
    expect(next).toBeGreaterThan(1.1)
  })

  test('asymmetry: brightening (down) is FASTER than darkening (up) for equal error magnitude', () => {
    // symmetric multiplicative error around target: measured = target/1.5 (dark) vs target*1.5 (bright)
    const dt = 0.1
    const up = adapt_exposure(1.1, cfg.target / 1.5, dt, cfg) - 1.1 // darker ⇒ +, SLOW
    const down = 1.1 - adapt_exposure(1.1, cfg.target * 1.5, dt, cfg) // brighter ⇒ −, FAST
    expect(down).toBeGreaterThan(up) // same-magnitude step moves further DOWN in one dt
  })

  test('clamped tight to [min,max]', () => {
    // a pitch-black measurement wants huge exposure — must clamp at max.
    let e = 1.1
    for (let i = 0; i < 300; i++) e = adapt_exposure(e, 0.001, 0.1, cfg)
    expect(e).toBeLessThanOrEqual(EXPOSURE_MAX + 1e-9)
    expect(e).toBeGreaterThanOrEqual(EXPOSURE_MIN - 1e-9)
    // a blown-white measurement wants tiny exposure — must clamp at min.
    let b = 1.1
    for (let i = 0; i < 300; i++) b = adapt_exposure(b, 0.99, 0.1, cfg)
    expect(b).toBeGreaterThanOrEqual(EXPOSURE_MIN - 1e-9)
    expect(b).toBeLessThanOrEqual(1.1)
  })

  test('converges to the fixed point when measurement tracks exposure (servo stability)', () => {
    // model: measured_ldr ≈ k * exposure (a linearized scene); fixed point at exposure = target/k.
    const k = 0.3
    let e = 1.1
    for (let i = 0; i < 2000; i++) {
      const measured = Math.min(0.99, k * e)
      e = adapt_exposure(e, measured, 0.05, cfg)
    }
    // fixed point target/k = 0.33/0.3 = 1.1, inside the clamp ⇒ should settle there.
    expect(e).toBeCloseTo(cfg.target / k, 1)
  })
})

describe('servo end-to-end — the slow down-tau no longer lets a VFX flash self-dim (BUG A)', () => {
  // Fold a PHYSICAL measured-luma trace through the shipped step (adapt_exposure, pre_render order). The servo is
  // RELATIVE (its fixed point is wherever measured == target), so measured must track the rendered exposure:
  // measured = k·exposure + a transient VFX bump. k pins the rest fixed point at exposure 1.1.
  const dt = 1 / 60
  const k = EXPOSURE_TARGET_LUMA / 1.1 // scene gain: at exposure 1.1 the rest full-frame avg == target 0.37
  const BUMP = 0.25 // extra full-frame luma a bright cast adds (harness: measured peaked ~0.58 over a ~0.35 rest)
  const sim = (/** @type {number} */ tau_fast, /** @type {number} */ flash_ms) => {
    const cfg = { target: EXPOSURE_TARGET_LUMA, tau_fast, tau_slow: 2.5, min: 0.85, max: 1.4 }
    let e = 1.1
    let min_e = 1.1
    for (let i = 0; i < Math.round(2 / dt); i++) {
      const t = i * dt
      const measured = Math.min(0.99, k * e + (t < flash_ms / 1000 ? BUMP : 0)) // scene responds to exposure
      e = adapt_exposure(e, measured, dt, cfg)
      if (e < min_e) min_e = e
    }
    return { min_e, final: e }
  }
  test('a 300ms flash barely dips exposure at the shipped down-tau; the old fast tau dived ~3× more', () => {
    const shipped = 1.1 - sim(ADAPT_TAU_FAST, 300).min_e // 2.0s — the fix
    const old = 1.1 - sim(0.6, 300).min_e // the pre-fix fast down-adaptation
    expect(old).toBeGreaterThan(0.06) // the old servo really dived on the flash (the washed-VFX bug)
    expect(shipped).toBeLessThan(0.04) // the fix: a sub-0.5s flash can no longer self-dim the frame it lit
    expect(shipped).toBeLessThan(old * 0.5) // >2× improvement
  })
  test('the flash never STICKS — the relative servo self-recovers to the rest point after it clears', () => {
    expect(sim(ADAPT_TAU_FAST, 300).final).toBeCloseTo(1.1, 1)
  })
  test('a SUSTAINED brightness still contracts (the sky↔canopy breathe survives)', () => {
    const sustained = 1.1 - sim(ADAPT_TAU_FAST, 5000).min_e // bright for the whole 2s window (a sky look-up)
    expect(sustained).toBeGreaterThan(0.1) // exposure still breathes DOWN on a genuine bright scene
  })
})

describe('average_luma — backend-robust readback decode', () => {
  test('Uint8Array (LDR byte) ⇒ value/255', () => {
    // one grey texel (128,128,128,255) ⇒ ~0.502
    const buf = new Uint8Array([128, 128, 128, 255])
    expect(average_luma(buf)).toBeCloseTo(128 / 255, 4)
  })
  test('Float32Array (float) ⇒ direct', () => {
    const buf = new Float32Array([0.5, 0.5, 0.5, 1])
    expect(average_luma(buf)).toBeCloseTo(0.5, 5)
  })
  test('Uint16Array (half-float) ⇒ IEEE-754 decode', () => {
    // 0.5 in half-float = 0x3800; 1.0 = 0x3c00
    const buf = new Uint16Array([0x3800, 0x3800, 0x3800, 0x3c00])
    expect(average_luma(buf)).toBeCloseTo(0.5, 4)
  })
  test('empty ⇒ 0 (servo holds)', () => {
    expect(average_luma(new Uint8Array([]))).toBe(0)
    expect(average_luma(null)).toBe(0)
  })
  test('averages multiple texels', () => {
    const buf = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]) // luma 0 and 1
    expect(average_luma(buf)).toBeCloseTo(0.5, 3)
  })
})

describe('create_auto_exposure factory', () => {
  test('starts at baseline; disabled ⇒ eases to baseline', () => {
    const ae = create_auto_exposure()
    expect(ae.exposure).toBe(EXPOSURE_BASELINE)
    ae.enabled.value = false
    const e = ae.pre_render(0.1)
    expect(e).toBeCloseTo(EXPOSURE_BASELINE, 5) // already at baseline, stays
  })
  test('pre_render holds at baseline with no measurement yet', () => {
    const ae = create_auto_exposure()
    expect(ae.pre_render(0.1)).toBe(EXPOSURE_BASELINE) // measured = -1 ⇒ hold
  })
  test('exposes live cfg with the shipped defaults', () => {
    const ae = create_auto_exposure()
    expect(ae.cfg.target).toBe(EXPOSURE_TARGET_LUMA)
    expect(ae.cfg.min).toBe(EXPOSURE_MIN)
    expect(ae.cfg.max).toBe(EXPOSURE_MAX)
  })
  test('post_render is a safe no-op without a renderer/target', () => {
    const ae = create_auto_exposure()
    expect(() => ae.post_render(null, null)).not.toThrow()
    expect(() => ae.post_render({}, { width: 4, height: 4 })).not.toThrow() // no readback fn ⇒ skip
  })
  test('disabled kill switch prevents GPU readback work', () => {
    const ae = create_auto_exposure({ enabled: false })
    let reads = 0
    ae.post_render(
      {
        readRenderTargetPixelsAsync: () => {
          reads += 1
          return Promise.resolve(new Uint8Array(4))
        },
      },
      { width: 1, height: 1 }
    )
    expect(reads).toBe(0)
  })
})
