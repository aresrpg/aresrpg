// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// [ENG camera-feel 2026-07-12] motion_blur.js pure-math regression. update() only touches three's
// Vector3/PerspectiveCamera math (no DOM/GPU) — same headless house pattern as camera_shake.test.js.
// Covers the NEW explicit run-speed trigger (added alongside the pre-existing D258 camera-motion
// trigger) without regressing either, plus the D251-2 fight kill-switch.
//
// TIMING NOTE: update()'s exponential damp derives dt from real performance.now() (floored at 1ms), not
// an injected dt — so every test drives enough iterations (300+) to fully settle regardless of any
// wall-clock jitter between calls (the floor only ever makes convergence FASTER than assumed, never
// slower, since a larger real dt raises the per-step damp rate — the iteration counts below assume the
// worst case, the 1ms floor, and still clear >99% convergence).

import { describe, it, expect } from 'bun:test'
import { PerspectiveCamera } from 'three'

import { create_camera_rotation_blur } from './motion_blur.js'

/** A camera that never moves/rotates between calls — isolates the run-speed trigger from the
 *  pre-existing camera-motion trigger (trans_speed/ang_speed both pin to exactly 0). */
function static_camera() {
  const cam = new PerspectiveCamera()
  cam.position.set(0, 0, 0)
  cam.updateMatrixWorld()
  return cam
}

const SETTLE_N = 300 // ≥99% converged at DAMP_HALFLIFE=0.06s even at the 1ms dt floor (worst case)

describe('motion_blur.js — radial vignette blur (pure math)', () => {
  it('at rest (zero speed, static camera) the blur stays OFF — byte-identical crisp frame', () => {
    const blur = create_camera_rotation_blur()
    const cam = static_camera()
    for (let i = 0; i < 10; i += 1) blur.update(cam, 0)
    expect(blur.u_mag.value).toBe(0)
  })

  it('walking speed alone (below the ~40% run-speed engage threshold) does NOT engage the blur', () => {
    const blur = create_camera_rotation_blur()
    const cam = static_camera()
    for (let i = 0; i < SETTLE_N; i += 1) blur.update(cam, 3) // well under RUN_ENGAGE_FRAC·RUN_SPEED_REF = 4.2
    expect(blur.u_mag.value).toBe(0)
  })

  it('running (speed ≥ the run-speed reference) with a STATIC camera still engages the blur — the new trigger', () => {
    const blur = create_camera_rotation_blur()
    const cam = static_camera()
    for (let i = 0; i < SETTLE_N; i += 1) blur.update(cam, 12) // above the 10.5 run-speed reference
    expect(blur.u_mag.value).toBeGreaterThan(0.05) // clearly engaged (ceiling is the tuned MAX_RADIAL)
  })

  it('a mid-run speed (~70% of the reference) engages PARTIALLY — a ramp, not a hard switch', () => {
    const full = create_camera_rotation_blur()
    const cam_full = static_camera()
    for (let i = 0; i < SETTLE_N; i += 1) full.update(cam_full, 12)

    const mid = create_camera_rotation_blur()
    const cam_mid = static_camera()
    for (let i = 0; i < SETTLE_N; i += 1) mid.update(cam_mid, 8) // between the 4.2 engage floor and 10.5 full
    expect(mid.u_mag.value).toBeGreaterThan(0) // engaged…
    expect(mid.u_mag.value).toBeLessThan(full.u_mag.value) // …but less than full-run strength
  })

  it('the ORIGINAL camera-motion trigger (fast pan, zero player speed) still engages — no D258 regression', () => {
    const blur = create_camera_rotation_blur()
    const cam = static_camera()
    for (let i = 0; i < SETTLE_N; i += 1) {
      cam.position.x += 1 // a large per-frame jump ⇒ trans_speed comfortably clears ENGAGE/FULL
      cam.updateMatrixWorld()
      blur.update(cam, 0) // speed=0 — isolates the pre-existing camera-motion trigger
    }
    expect(blur.u_mag.value).toBeGreaterThan(0.05)
  })

  it('running AND panning at once never exceeds the single-trigger ceiling (max(), never sum)', () => {
    const run_only = create_camera_rotation_blur()
    const cam1 = static_camera()
    for (let i = 0; i < SETTLE_N; i += 1) run_only.update(cam1, 12)
    const saturated = run_only.u_mag.value
    expect(saturated).toBeGreaterThan(0.05) // sanity: run-only alone did saturate

    const both = create_camera_rotation_blur()
    const cam2 = static_camera()
    for (let i = 0; i < SETTLE_N; i += 1) {
      cam2.position.x += 1
      cam2.updateMatrixWorld()
      both.update(cam2, 12) // running WHILE continuously whip-panning
    }
    // both triggers independently saturate at the SAME ceiling (max_radial) — max() composition means
    // combining them can't exceed what either alone reaches (a SUM would read roughly double this).
    expect(both.u_mag.value).toBeLessThanOrEqual(saturated + 0.01)
    expect(both.u_mag.value).toBeGreaterThan(saturated - 0.01)
  })

  it('set_enabled(false) pins the blur OFF regardless of speed (the no-blur-in-fights law)', () => {
    const blur = create_camera_rotation_blur()
    const cam = static_camera()
    for (let i = 0; i < SETTLE_N; i += 1) blur.update(cam, 12)
    expect(blur.u_mag.value).toBeGreaterThan(0.05) // engaged first…
    blur.set_enabled(false)
    blur.update(cam, 12)
    expect(blur.u_mag.value).toBe(0) // …then killed instantly, even at full run speed
  })
})
