// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FIRST-LOAD radial REVEAL FRONT — a shader loading-feel effect. ONE global uniform
// set — a centre (spawn/player XZ) + an expanding radius — threaded into every terrain-class material
// (like board_occlusion). Terrain beyond the front is hidden/faded by a ~band-metre smoothstep, so a
// chunk that streams in beyond the front stays hidden until the front sweeps past it: pop-in becomes a
// deliberate "world weaving in". engine.js drives the radius each frame off the ring's filled-column
// count (nearest-first ⇒ a growing disc), eased + MONOTONIC (never re-hides), with a time floor that
// guarantees completion within ~COMPLETE_MS even if streaming stalls. NO per-chunk data — pure world math.
//
// The dissolve/rise/scan VARIANT is chosen at material build time (?reveal=, default dissolve) so only ONE
// variant's graph compiles — reveal_front carries only the geometry (centre/radius/band), not the mode.

import { Vector2 } from 'three'
import { uniform } from 'three/tsl'

const BAND_M = 7 // smoothstep transition width at the front edge (metres)
const COMPLETE_MS = 5000 // worst-case time to full reveal (target: within ~5s)
const EASE = 5.0 // exponential approach rate toward the fill target (higher = tighter to the fill edge)
const MIN_REVEAL_M = 24 // the player's own tile is always revealed (never dissolve the ground under the feet)
const SENTINEL_M = 1e6 // radius past which the whole world is inside the front ⇒ no discard/offset (steady state)

/**
 * @typedef {object} RevealFront
 * @property {*} center vec2 uniform (world XZ reveal origin) — threaded into every terrain material
 * @property {*} radius float uniform (metres from centre; the front edge)
 * @property {*} band float uniform (smoothstep transition width)
 * @property {(cx: number, cz: number) => void} set_center set the reveal origin (boot spawn/camera XZ)
 * @property {(rendered_columns: number, ring_extent_m: number, dt: number) => void} drive advance one frame
 * @property {() => boolean} is_done the front reached the ring extent (folded to a no-op)
 */
/** @returns {RevealFront} */
export function create_reveal_front() {
  const center = uniform(new Vector2(0, 0))
  const radius = uniform(SENTINEL_M) // DEFAULT fully revealed — a material never driven (or the far shell) never discards
  const band = uniform(BAND_M)
  let started = false
  let elapsed = 0
  let cur = 0
  let done = false

  return {
    center,
    radius,
    band,
    /** Set the reveal origin (captured once by engine.js = the boot spawn/camera XZ). */
    set_center(cx, cz) {
      center.value.set(cx, cz)
    },
    /**
     * Advance the front one frame. Target = max(filled-disc radius, time floor); eased toward it but
     * clamped monotonic; snaps to SENTINEL (no effect) once it reaches the near-ring extent.
     * @param {number} rendered_columns ring.rendered_column_count()
     * @param {number} ring_extent_m near-ring radius in metres (loaded_radius_blocks)
     * @param {number} dt seconds
     */
    drive(rendered_columns, ring_extent_m, dt) {
      if (done) return
      if (!started) {
        started = true
        cur = MIN_REVEAL_M
      }
      elapsed += dt * 1000
      const disc_r = Math.sqrt(Math.max(0, rendered_columns) / Math.PI) * 32 // filled disc radius (chunks→m)
      const time_r = (elapsed / COMPLETE_MS) * (ring_extent_m + BAND_M)
      const target = Math.max(MIN_REVEAL_M, disc_r, time_r)
      // exponential ease toward target, MONOTONIC (Math.max ⇒ never recede — never re-hides)
      cur = Math.max(cur, cur + (target - cur) * Math.min(1, EASE * dt))
      radius.value = cur
      if (cur >= ring_extent_m && ring_extent_m > 0) {
        radius.value = SENTINEL_M
        done = true
      }
    },
    is_done() {
      return done
    },
  }
}
