// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure vector math for the left-thumb virtual joystick (MOBILE_SUPPORT_PLAN.md M-03 / §2.1). Zero DOM,
// zero React — a drag delta in pixels goes in, a normalized {forward, strafe} in the engine's documented
// -1..1 contract comes out (packages/engine/src/player/character_controller.js:49-51 — "forward positive",
// "strafe -1..1 (right positive)"). Sign convention mirrors embed_voxel_movement_keys.js:23-36 (KeyW/ArrowUp
// = forward +1, KeyD/ArrowRight = strafe +1) so a touch player and a keyboard player pushing "the same"
// direction get the same result — M-04 merges this into the same `set_input()` sink, unchanged.
//
// Deliberately does NOT clamp forward/strafe as independent axes (a classic joystick bug: clamping dx and
// dy to [-1,1] separately lets a diagonal drag report forward=1 AND strafe=1 simultaneously — a vector of
// length sqrt(2), i.e. a free diagonal speed boost). Magnitude here is derived from the true 2D drag
// distance, so hypot(forward, strafe) can never exceed 1 by construction — see the diagonal test in
// touch_stick.test.js.

/** Visual + gameplay outer radius, px, at 1x UI scale. TouchControls may override per its own hit-zone size. */
export const STICK_MAX_RADIUS_PX = 48

/** Ratio of max radius treated as dead zone — absorbs thumb-rest jitter without eating travel range. */
export const STICK_DEAD_ZONE_RATIO = 0.18

/**
 * @typedef {Object} StickVector
 * @property {number} forward -1..1, up positive (character_controller's documented contract)
 * @property {number} strafe -1..1, right positive
 * @property {number} magnitude 0..1, post-dead-zone eased magnitude — what gameplay reads
 * @property {number} angle radians, atan2(dy, dx) in screen space
 * @property {number} clamped_dx px, drag position clamped to max_radius — for the visual thumb (dead-zone-agnostic: the nub tracks the thumb even inside the dead zone, only the OUTPUT magnitude gates there)
 * @property {number} clamped_dy px, ditto
 */

/**
 * @param {number} dx raw drag delta from the stick's spawned center, px (+right)
 * @param {number} dy raw drag delta from the stick's spawned center, px (+down, screen convention)
 * @param {{max_radius?: number, dead_zone?: number}} [opts]
 * @returns {StickVector}
 */
export function compute_stick_vector(dx, dy, opts = {}) {
  const max_radius = opts.max_radius ?? STICK_MAX_RADIUS_PX
  const dead_zone = opts.dead_zone ?? STICK_DEAD_ZONE_RATIO

  const raw_dist = Math.hypot(dx, dy)
  const angle = Math.atan2(dy, dx) // atan2(0,0) === 0 per spec — safe at rest, no NaN branch needed
  const clamped_dist = Math.min(raw_dist, max_radius)
  const clamped_dx = Math.cos(angle) * clamped_dist
  const clamped_dy = Math.sin(angle) * clamped_dist

  const dead_radius = dead_zone * max_radius
  const usable_radius = max_radius - dead_radius
  const magnitude = usable_radius <= 0 ? 0 : Math.min(1, Math.max(0, (clamped_dist - dead_radius) / usable_radius))

  // `+ 0` scrubs the -0 that `-Math.sin(angle) * 0` (or `Math.cos * 0`) produces at rest / in the dead
  // zone — behaviorally identical to 0 in arithmetic, but a surprising `toBe(0)` failure and a footgun
  // for anything that inspects sign (Math.sign(-0) === -0).
  return {
    forward: -Math.sin(angle) * magnitude + 0,
    strafe: Math.cos(angle) * magnitude + 0,
    magnitude,
    angle,
    clamped_dx,
    clamped_dy,
  }
}

/**
 * Clamp a dynamically-spawned stick center so its outer radius stays fully inside the given bounds — the
 * plan's "touch anywhere in the lower-left quadrant, stick centers under the thumb" dynamic-spawn ruling
 * (§2.1) still must not render the base clipped off-screen when the thumb lands right at a zone edge.
 * @param {number} x @param {number} y
 * @param {{radius: number, min_x: number, min_y: number, max_x: number, max_y: number}} bounds
 */
export function clamp_stick_origin(x, y, bounds) {
  const { radius, min_x, min_y, max_x, max_y } = bounds
  return {
    x: Math.min(Math.max(x, min_x + radius), max_x - radius),
    y: Math.min(Math.max(y, min_y + radius), max_y - radius),
  }
}
