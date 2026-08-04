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
import { PerspectiveCamera, Scene } from 'three'
import { float } from 'three/tsl'

import { create_vfx_overlay, depth_fade_mask } from '../../src/render/vfx_overlay_pass.js'

// The #158 FIX floor (OVERLAY_SOFT_FLOOR) — hard-coded here to pin the shipped default; the mask never
// drops below it, so a ground-anchored cast (gap≈0) can never vanish. The `soft_floor=0` arg restores the
// pre-fix hard fade for the occlusion tests that assert the raw smoothstep shape.
const FLOOR = 0.5

test('the post overlay multiplier is neutral because routed materials own the output gain', () => {
  const overlay = create_vfx_overlay({
    scene: new Scene(),
    camera: new PerspectiveCamera(),
    scene_depth: float(1),
  })
  expect(overlay.gain.value).toBe(1)
  overlay.dispose()
})

describe('depth_fade_mask — soft-particle depth fade (#158)', () => {
  test('#158 FIX: gap ≤ 0 floors to OVERLAY_SOFT_FLOOR (soft occlusion) instead of a hard 0 — never invisible', () => {
    // RED before the floor (was 0 — the exact "ground-anchored cast vanishes" bug); GREEN after.
    expect(depth_fade_mask(0)).toBe(FLOOR)
    expect(depth_fade_mask(-1)).toBe(FLOOR)
    expect(depth_fade_mask(-1000)).toBe(FLOOR)
  })

  test('raw fade shape (soft_floor=0) — occluded gap ≤ 0 is the intentional hard 0 the smoothstep still emits', () => {
    expect(depth_fade_mask(0, 0.4, 0, 0)).toBe(0)
    expect(depth_fade_mask(-1, 0.4, 0, 0)).toBe(0)
  })

  test('ramps smoothly across the fade band and saturates at/after the fade distance (raw, soft_floor=0)', () => {
    expect(depth_fade_mask(0.2, 0.4, 0, 0)).toBeCloseTo(0.5, 6) // classic Hermite smoothstep midpoint
    expect(depth_fade_mask(0.4, 0.4, 0, 0)).toBeCloseTo(1, 6)
    expect(depth_fade_mask(10, 0.4, 0, 0)).toBe(1)
  })

  test('monotonically non-decreasing across the band (no ring/pop artifact)', () => {
    let prev = depth_fade_mask(-1)
    for (let g = -1; g <= 1; g += 0.05) {
      const m = depth_fade_mask(g)
      expect(m).toBeGreaterThanOrEqual(prev - 1e-9)
      expect(m).toBeGreaterThanOrEqual(FLOOR - 1e-9) // never below the floor
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

describe('depth_fade_mask — #158 no_fade diagnostic bypass (window.__vfx_overlay.no_fade)', () => {
  test('no_fade=1 forces FULL visibility even for a gap that would otherwise mask to 0', () => {
    // The live lever: a ground-anchored cast sits at gap≈0 (soft would be 0) under a top-down fight
    // camera; flipping no_fade on must read it fully visible (composite()'s `.max(u_no_fade)`).
    expect(depth_fade_mask(-1, 0.4, 1)).toBe(1)
    expect(depth_fade_mask(0, 0.4, 1)).toBe(1)
    expect(depth_fade_mask(0.2, 0.4, 1)).toBe(1) // even mid-band snaps to full
  })

  test('no_fade default (0 / omitted) leaves the floored fade in place — the knob is a true no-op when off', () => {
    expect(depth_fade_mask(-1, 0.4, 0)).toBe(FLOOR) // floored (not the pre-fix 0), because no_fade is off
    expect(depth_fade_mask(0.2, 0.4, 0)).toBeCloseTo(0.5, 6)
    expect(depth_fade_mask(0.2, 0.4)).toBeCloseTo(0.5, 6) // omitted args ≡ defaults
  })

  test('soft_floor is tunable — a higher floor lifts the whole mask, 0 restores the pre-fix hard fade', () => {
    expect(depth_fade_mask(-1, 0.4, 0, 0.8)).toBe(0.8) // owner grades visibility up
    expect(depth_fade_mask(0.2, 0.4, 0, 0.8)).toBe(0.8) // floor dominates the mid-band smoothstep
    expect(depth_fade_mask(-1, 0.4, 0, 0)).toBe(0) // soft_floor=0 ⇒ exact pre-fix occlusion cut
  })
})
