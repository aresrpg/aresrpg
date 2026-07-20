// Continuous celestial clock + closed sun/moon orbit. Time-of-day callers may publish a fresh phase at any
// cadence; the renderer advances that phase from a monotonic wall-clock anchor on every frame, so the visible
// bodies never inherit the publisher's cadence.

import { Vector3 } from 'three'

/** Full configured cycle: 15 minutes of sun-above-horizon + 5 minutes below. */
export const CELESTIAL_CYCLE_MS = 20 * 60 * 1000
/** Fraction of one orbit for which the sun is above the horizon. */
export const DAY_FRAC = 0.75

const TAU = Math.PI * 2
const ORBIT_PHASE = -Math.PI / 4
const ORBIT_RADIUS = Math.sqrt(2 / 3)
const ORBIT_CENTER = 1 / Math.sqrt(6)
const ORBIT_VERTICAL = 1 / Math.sqrt(3)

/** @param {number} x @returns {number} wrap into [0,1). */
const wrap01 = (x) => x - Math.floor(x)

/**
 * Unwrapped celestial angle at a wall-clock offset. Keeping this unwrapped is deliberate: equal real-time
 * deltas always produce exactly equal angle deltas, including across any number of cycle boundaries.
 * @param {number} elapsed_ms monotonic milliseconds since the anchor
 * @param {number} [anchor_tod] phase at the anchor, in turns
 * @param {number} [cycle_ms] full cycle duration
 * @returns {number} unwrapped radians
 */
export function celestial_angle_at(elapsed_ms, anchor_tod = 0, cycle_ms = CELESTIAL_CYCLE_MS) {
  return (anchor_tod + elapsed_ms / cycle_ms) * TAU
}

/**
 * Wrapped time-of-day sampled from the same linear wall clock.
 * @param {number} elapsed_ms monotonic milliseconds since the anchor
 * @param {number} [anchor_tod] phase at the anchor, in turns
 * @param {number} [cycle_ms] full cycle duration
 * @returns {number} phase in [0,1)
 */
export function celestial_tod_at(elapsed_ms, anchor_tod = 0, cycle_ms = CELESTIAL_CYCLE_MS) {
  return wrap01(celestial_angle_at(elapsed_ms, anchor_tod, cycle_ms) / TAU)
}

/**
 * Whether two external phase samples prove the configured linear wall clock. A minimum one-tolerance phase
 * advance keeps repeated screenshot/demo pins from accidentally starting the clock on a short call interval.
 * @param {number} previous_tod earlier external phase sample
 * @param {number} next_tod later external phase sample
 * @param {number} elapsed_ms monotonic milliseconds between samples
 * @param {number} [tolerance_ms] allowed publisher/callback skew
 * @param {number} [cycle_ms] full cycle duration
 * @returns {boolean}
 */
export function is_linear_celestial_step(
  previous_tod,
  next_tod,
  elapsed_ms,
  tolerance_ms = 50,
  cycle_ms = CELESTIAL_CYCLE_MS
) {
  if (!(elapsed_ms > 0) || !(cycle_ms > 0) || !(tolerance_ms >= 0)) return false
  const observed_delta = wrap01(next_tod - previous_tod)
  const expected_delta = wrap01(elapsed_ms / cycle_ms)
  const tolerance = tolerance_ms / cycle_ms
  return observed_delta > tolerance && Math.abs(observed_delta - expected_delta) <= tolerance
}

/**
 * Closed constant-speed small-circle orbit. It preserves the configured 3:1 horizon occupancy while avoiding
 * the old unequal day/night keyframes: for equal phase deltas, `dot(dir(t), dir(t+delta))` is position-
 * independent (`1/3 + 2/3*cos(TAU*delta)`), including at the wrap. Sunrise is t=0, noon t=3/8, sunset
 * t=3/4. The vector is unit length by construction.
 * @param {number} tod phase in turns; wrapping is implicit in sin/cos
 * @param {Vector3} [out] optional target
 * @returns {Vector3}
 */
export function sun_dir_from_tod(tod, out = new Vector3()) {
  const angle = tod * TAU + ORBIT_PHASE
  const sin_angle = Math.sin(angle)
  return out.set(
    ORBIT_RADIUS * Math.cos(angle),
    ORBIT_CENTER + ORBIT_VERTICAL * sin_angle,
    ORBIT_CENTER - ORBIT_VERTICAL * sin_angle
  )
}

/**
 * The moon shares the same clock and is always exactly opposite the sun.
 * @param {number} tod phase in turns
 * @param {Vector3} [out] optional target
 * @returns {Vector3}
 */
export function moon_dir_from_tod(tod, out = new Vector3()) {
  return sun_dir_from_tod(tod, out).multiplyScalar(-1)
}
