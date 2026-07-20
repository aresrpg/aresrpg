// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ENG-18 — WORLD BORDER (physics + signal half). The PURE side of the mana barrier: it owns the
// active zone bounds, the position soft-clamp the camera funnels through, and the border-proximity
// signal the dapp drives its hum loop from. NO three.js here — this is the single home for the border
// MATH so it unit-tests without a GPU and the controller/collision layer stays three-free. The visual
// wall (render/mana_barrier.js) reads these same bounds + the nearest-wall geometry to draw the shader.
//
// WHY A HARD CLAMP READS AS "SOFT": we clamp the camera position to the wall plane every frame
// (idempotent — clamping an already-inside point is a no-op), so a sprint into the edge simply STOPS at
// the plane with zero overshoot and zero jitter (a fixed plane is a stable attractor, unlike a
// velocity-reflect which rings). The "soft pushback" the player feels is the visual ramp (mana_barrier
// brightens locally as you approach) + the fact that the clamp only bites in the last PUSHBACK_BAND
// metres, easing you off the edge rather than a bare wall-slam at the exact line. No teleport: the point
// never jumps anywhere except straight back onto the nearest face by the minimum distance.

import { clamp } from './math_utils.js'

/** @typedef {{ min_x: number, min_z: number, max_x: number, max_z: number }} ZoneBounds */

/** Metres from the wall where the barrier's approach feedback begins to ramp (the "you are nearing the
 *  edge" tell). border_proximity reaches 1 at the wall and 0 at this distance. Matches the ENG-18 brief's
 *  ~8 m local ramp-up band. */
export const PROXIMITY_RANGE_M = 8

/** The inward cushion (metres) held between the player and the true wall plane. The camera clamps to
 *  (edge − CUSHION) so the eye never sits exactly on the shader sheet (which would z-fight the fresnel
 *  and let the near face fill the screen). Small — it's a skin, not a fence. */
export const WALL_CUSHION_M = 0.5

/** The last band before the cushion where the clamp eases the player back with a fractional pull instead
 *  of a bare stop, so pressing into the wall decelerates over ~0.6 m rather than hitting a dead line. The
 *  hard clamp at (edge − CUSHION) still guarantees no tunnel-through past it. */
export const PUSHBACK_BAND_M = 0.6

/**
 * True iff `b` is a well-formed, non-degenerate zone bounds (min strictly below max on both axes and all
 * finite). Guards the engine setter so a malformed dapp payload can't half-arm the border.
 * @param {unknown} b @returns {b is ZoneBounds}
 */
export function is_valid_bounds(b) {
  if (!b || typeof b !== 'object') return false
  const { min_x, min_z, max_x, max_z } = /** @type {ZoneBounds} */ (b)
  return (
    Number.isFinite(min_x) &&
    Number.isFinite(min_z) &&
    Number.isFinite(max_x) &&
    Number.isFinite(max_z) &&
    max_x > min_x &&
    max_z > min_z
  )
}

/**
 * Signed inset distance of an XZ point from the NEAREST wall, POSITIVE inside the zone (metres to the
 * closest of the 4 faces) and NEGATIVE outside (how far past the wall it sits). This is the one geometry
 * primitive every border readout derives from: proximity, the clamp, and the render brightening all key
 * off "how close to / far past the nearest face am I".
 * @param {number} x @param {number} z @param {ZoneBounds} b
 * @returns {number} metres to the nearest face (>0 inside, ≤0 on/outside)
 */
export function inset_from_wall(x, z, b) {
  // distance to each face from inside (positive when inside that face's half-space)
  const to_min_x = x - b.min_x
  const to_max_x = b.max_x - x
  const to_min_z = z - b.min_z
  const to_max_z = b.max_z - z
  return Math.min(to_min_x, to_max_x, to_min_z, to_max_z)
}

/**
 * The world-space XZ point ON the zone perimeter nearest to (x,z): the point projected onto whichever of
 * the 4 faces is closest (clamped to the rectangle's edge). The render layer centres its local approach
 * brightening here (the classic MMO "the wall lights up where you push on it" tell). For a point inside
 * the box the nearest boundary point sits on the closest face at the point's own coordinate on the other
 * axis. @param {number} x @param {number} z @param {ZoneBounds} b @returns {[number, number]} [wx, wz]
 */
export function nearest_wall_point(x, z, b) {
  const to_min_x = x - b.min_x
  const to_max_x = b.max_x - x
  const to_min_z = z - b.min_z
  const to_max_z = b.max_z - z
  const m = Math.min(to_min_x, to_max_x, to_min_z, to_max_z)
  // Snap the coordinate on the nearest face's axis to the wall; keep the other axis (clamped into the
  // span so a point beyond a corner projects onto the corner, not off the end of a face).
  if (m === to_min_x) return [b.min_x, clamp(z, b.min_z, b.max_z)]
  if (m === to_max_x) return [b.max_x, clamp(z, b.min_z, b.max_z)]
  if (m === to_min_z) return [clamp(x, b.min_x, b.max_x), b.min_z]
  return [clamp(x, b.min_x, b.max_x), b.max_z]
}

/**
 * Border proximity in [0,1]: 0 when ≥ PROXIMITY_RANGE_M inside the zone, ramping to 1 AT the wall and
 * pinned at 1 anywhere outside. Smooth (smoothstep) so a dapp hum loop cross-fades without a hard knee.
 * This is the signal exposed on get_stats().border_proximity for spatial audio (the engine ships no
 * audio). @param {number} x @param {number} z @param {ZoneBounds} b @returns {number} 0..1
 */
export function border_proximity(x, z, b) {
  const inset = inset_from_wall(x, z, b)
  if (inset <= 0) return 1 // on or past the wall
  if (inset >= PROXIMITY_RANGE_M) return 0
  // t = 0 at the range edge → 1 at the wall; smoothstep for an ease-in-out ramp.
  const t = 1 - inset / PROXIMITY_RANGE_M
  return t * t * (3 - 2 * t)
}

/**
 * Soft-clamps an XZ position inside the zone (Y untouched — the barrier is a vertical fence, ceilings
 * aren't bounded). Returns the corrected position plus whether it bit and the inward push direction (for
 * the render tell / optional velocity damp). The clamp:
 *   • HARD floor at (edge − WALL_CUSHION): the point can never end up past this, so a sprint or a huge
 *     dt step cannot tunnel through (the clamp is absolute, speed-independent);
 *   • a SOFT lead-in across PUSHBACK_BAND before the cushion: in that band the point is eased a fraction
 *     of the way back rather than hard-pinned, so pressing into the wall decelerates smoothly instead of
 *     slamming a dead line (the hard floor still backstops it).
 * Idempotent: an already-inside point (inset > band) is returned unchanged with clamped=false.
 * @param {[number, number, number]} pos world [x, y, z]
 * @param {ZoneBounds} b
 * @returns {{ position: [number, number, number], clamped: boolean, push: [number, number] }}
 *   push = unit inward XZ direction off the nearest wall (zero when not clamped).
 */
export function clamp_to_bounds(pos, b) {
  const [x, y, z] = pos
  // Per-axis hard limits (the cushion inset). Each axis clamps independently so a corner clamps on both.
  const lo_x = b.min_x + WALL_CUSHION_M
  const hi_x = b.max_x - WALL_CUSHION_M
  const lo_z = b.min_z + WALL_CUSHION_M
  const hi_z = b.max_z - WALL_CUSHION_M

  let cx = x
  let cz = z
  let clamped = false
  let push_x = 0
  let push_z = 0

  // The soft band starts PUSHBACK_BAND before the hard limit; inside it we ease back, past it we pin.
  // ease_axis returns the corrected coordinate for one axis given its [lo, hi] hard span.
  const r = soft_clamp_axis(x, lo_x, hi_x)
  cx = r.value
  if (r.dir !== 0) {
    clamped = true
    push_x = r.dir
  }
  const rz = soft_clamp_axis(z, lo_z, hi_z)
  cz = rz.value
  if (rz.dir !== 0) {
    clamped = true
    push_z = rz.dir
  }

  // normalise the push (diagonal at a corner) — a unit inward direction for the render tell.
  const len = Math.hypot(push_x, push_z)
  const push = /** @type {[number, number]} */ (len > 1e-6 ? [push_x / len, push_z / len] : [0, 0])
  return { position: [cx, y, cz], clamped, push }
}

/**
 * One-axis soft clamp. The wall backstop is the hard span [lo, hi] (edge − cushion) — a point past it is
 * pinned exactly there, so nothing tunnels through no matter the step size. Inside the last PUSHBACK_BAND
 * before a limit the point is eased a fraction toward a REST TARGET (the band's inner edge, lo+BAND /
 * hi−BAND) rather than left on the wall — so pressing in decelerates over a few frames and settles a
 * hair off the wall (a cushion, not a slam). Easing toward a FIXED target (not a moving overshoot) makes
 * repeated application converge geometrically to that rest point — no jitter/oscillation.
 * Returns the corrected value + the inward push sign on this axis (+1 = pushed off the low wall toward
 * +axis, −1 = off the high wall; 0 when untouched). @param {number} v @param {number} lo @param {number} hi
 * @returns {{ value: number, dir: number }}
 */
function soft_clamp_axis(v, lo, hi) {
  if (v < lo) return { value: lo, dir: +1 } // past the low wall → pin, push +axis (inward)
  if (v > hi) return { value: hi, dir: -1 } // past the high wall → pin, push −axis (inward)
  // (exactly on a pinned edge falls through to the soft ease below so a slammed point relaxes inward
  //  to the rest edge next frame instead of sticking on the hard line.)
  // inside the hard span — ease toward the band's inner rest edge if within PUSHBACK_BAND of a limit.
  const rest_lo = lo + PUSHBACK_BAND_M
  const rest_hi = hi - PUSHBACK_BAND_M
  if (v < rest_lo) return { value: v + (rest_lo - v) * SOFT_EASE_FRACTION, dir: +1 }
  if (v > rest_hi) return { value: v - (v - rest_hi) * SOFT_EASE_FRACTION, dir: -1 }
  return { value: v, dir: 0 }
}

/** Fraction of the gap to the rest target closed each call — geometric ease-in over a few frames (reads
 *  as a decelerating cushion) that converges to the rest edge under repeated application. */
const SOFT_EASE_FRACTION = 0.25

// clamp imported from ./math_utils.js (canonical).
