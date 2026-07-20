// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// [D248] TRIGGERED CAMERA SHAKE — the impact cue for the fight cast-VFX wave. Fired by the app when a
// hit lands (engine.shake_camera(mag)); the engine applies a decaying, NON-accumulating offset to the
// camera right before the frame renders, then restores the base pose so the shake never drifts the rig.
//
// Tuning is measured from a licensed reference install (numbers are tuning, not assets): fast ATTACK
// to the peak at ~11% of the shake, long ease-OUT to zero by ~0.6 s; a positional jitter along a random
// screen-plane direction PLUS a small camera roll (the reference mixes rotational + positional shakes
// for weight). Amplitude classes: 0.10 light hit / 0.20 standard / 0.5+ crit/ult. At rest the offset is
// exactly zero (byte-identical frame), like the D214 blur.

import { Vector3 } from 'three'

/** Shake duration (s) — the whole attack+decay envelope. */
export const SHAKE_DURATION = 0.6
/** Envelope peak position as a fraction of the duration (~11% — the measured fast attack). */
export const SHAKE_PEAK_FRAC = 0.108
/** World-meters of positional jitter per unit amplitude at the peak (a 0.20 shake ⇒ ~0.10 m). */
const POS_PER_AMP = 0.5
/** Radians of camera roll per unit amplitude at the peak (a 0.20 shake ⇒ ~0.017 rad ≈ 1°). */
const ROLL_PER_AMP = 0.085

/**
 * The attack-decay envelope ∈ [0,1]: 0 at u=0, rises to 1 at u=SHAKE_PEAK_FRAC, eases to ~0 by u=1.
 * `(u/p)·e^(1−u/p)` — the classic single-peak impulse (peak exactly 1 at u=p, fast in / slow out).
 * Pure + exported so the envelope is unit-testable without a camera.
 * @param {number} u normalized time (elapsed / SHAKE_DURATION), ≥ 0
 * @returns {number}
 */
export function shake_envelope(u) {
  if (u <= 0 || u >= 1) return 0
  const r = u / SHAKE_PEAK_FRAC
  return r * Math.exp(1 - r)
}

/**
 * Creates a camera-shake driver. The engine calls apply(camera, dt) each frame BEFORE render (it
 * offsets the camera and returns a restore fn to call AFTER render, so the base pose is untouched).
 * trigger(mag) (re)starts the shake; the strongest active amplitude wins (a crit over a chip hit).
 */
export function create_camera_shake() {
  let t = SHAKE_DURATION // start finished (idle)
  let amp = 0
  const dir = new Vector3() // random screen-plane direction, chosen per trigger
  let roll_sign = 1
  const _right = new Vector3()
  const _up = new Vector3()
  const _saved = new Vector3()

  return {
    /** Fire (or re-fire) the shake. @param {number} mag amplitude (0.10 light / 0.20 std / 0.5+ crit) */
    trigger(mag) {
      const m = Math.max(0, mag || 0)
      if (m <= 0) return
      // a re-trigger only ever strengthens an in-flight shake (never cuts a big hit short)
      if (t < SHAKE_DURATION && amp > m) {
        t = 0
        return
      }
      t = 0
      amp = m
      const a = Math.random() * Math.PI * 2
      dir.set(Math.cos(a), Math.sin(a), 0)
      roll_sign = Math.random() < 0.5 ? -1 : 1
    },

    /** True while a shake is in flight (the engine skips the offset dance when idle). */
    get active() {
      return t < SHAKE_DURATION
    },

    /**
     * Offset the camera for THIS frame; returns a restore() to run after render (non-accumulating).
     * @param {import('three').PerspectiveCamera} camera
     * @param {number} dt seconds
     * @returns {(() => void) | null} restore fn, or null when idle (nothing offset)
     */
    apply(camera, dt) {
      t += dt
      if (t >= SHAKE_DURATION) {
        amp = 0
        return null
      }
      const env = shake_envelope(t / SHAKE_DURATION) * amp
      if (env <= 1e-6) return null
      // screen-plane jitter: offset along the camera's own right/up so the shake reads on-screen.
      _right.setFromMatrixColumn(camera.matrixWorld, 0)
      _up.setFromMatrixColumn(camera.matrixWorld, 1)
      _saved.copy(camera.position)
      const roll0 = camera.rotation.z
      camera.position.addScaledVector(_right, dir.x * env * POS_PER_AMP).addScaledVector(_up, dir.y * env * POS_PER_AMP)
      camera.rotation.z = roll0 + roll_sign * env * ROLL_PER_AMP
      camera.updateMatrixWorld()
      return () => {
        camera.position.copy(_saved)
        camera.rotation.z = roll0
        camera.updateMatrixWorld()
      }
    },
  }
}
