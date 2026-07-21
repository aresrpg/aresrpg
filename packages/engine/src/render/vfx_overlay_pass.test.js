// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #158 — the fight-VFX overlay's soft-particle depth-fade mask (vfx_overlay_pass.js composite()). Pure
// JS mirror of the TSL `smoothstep(0, SOFT_FADE_DIST, gap)` graph (same idiom as particles.js's
// sprite_falloff — the JS reference is the tested contract; the shader mirrors it op-for-op, GPU
// wiring itself is the wiring wave's concern). Pins the backend-robustness contract this pass now
// carries: a degenerate (non-finite) depth comparison — the failure mode a stale `reversedDepthBuffer`
// after a silent WebGPU→WebGL2 fallback can produce (see renderer.js's #158 correction) — must fail
// OPEN (full visibility), never closed (a silent, consoleless "no fight VFX ever again").

import { describe, expect, test } from 'bun:test'

import { depth_fade_mask } from './vfx_overlay_pass.js'

describe('depth_fade_mask — soft-particle depth fade (#158)', () => {
  test('occluded (gap ≤ 0) is fully masked — the intentional occlusion behaviour is UNCHANGED', () => {
    expect(depth_fade_mask(0)).toBe(0)
    expect(depth_fade_mask(-1)).toBe(0)
    expect(depth_fade_mask(-1000)).toBe(0)
  })

  test('ramps smoothly across the fade band and saturates at/after the fade distance', () => {
    expect(depth_fade_mask(0.2, 0.4)).toBeCloseTo(0.5, 6) // classic Hermite smoothstep midpoint
    expect(depth_fade_mask(0.4, 0.4)).toBeCloseTo(1, 6)
    expect(depth_fade_mask(10, 0.4)).toBe(1)
  })

  test('monotonically non-decreasing across the band (no ring/pop artifact)', () => {
    let prev = depth_fade_mask(-1)
    for (let g = -1; g <= 1; g += 0.05) {
      const m = depth_fade_mask(g)
      expect(m).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = m
    }
  })

  test('#158 FAIL-OPEN: a degenerate (NaN) gap resolves to FULL VISIBILITY, never a silent 0', () => {
    expect(depth_fade_mask(NaN)).toBe(1)
    expect(depth_fade_mask(0 / 0)).toBe(1)
  })

  test('#158 FAIL-OPEN: ±Infinity never yields a false-invisible mask either', () => {
    expect(depth_fade_mask(Infinity)).toBe(1)
    expect(depth_fade_mask(-Infinity), 'plain smoothstep would clamp this to 0 — the exact bug class').toBe(1)
  })
})
