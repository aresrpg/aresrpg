// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Continuous celestial clock + closed sun/moon orbit. Time-of-day callers may publish a fresh phase at any
// cadence; the renderer advances that phase from a monotonic wall-clock anchor on every frame, so the visible
// bodies never inherit the publisher's cadence.

import { Vector3 } from 'three'

/** Full configured cycle: 15 minutes of sun-above-horizon + 5 minutes below. */
export const CELESTIAL_CYCLE_MS = 20 * 60 * 1000
/** Fraction of one orbit for which the sun is above the horizon. */
export const DAY_FRAC = 0.75
/** Midpoint of the daylight arc, with the sun at its highest elevation. */
export const MIDDAY_TIME_OF_DAY = DAY_FRAC / 2

const TAU = Math.PI * 2
const ORBIT_PHASE = -Math.PI / 4
const ORBIT_RADIUS = Math.sqrt(2 / 3)
const ORBIT_CENTER = 1 / Math.sqrt(6)
const ORBIT_VERTICAL = 1 / Math.sqrt(3)

/**
 * Closed constant-speed small-circle orbit. It preserves the configured 3:1 horizon occupancy while avoiding
 * the old unequal day/night keyframes: for equal phase deltas, `dot(dir(t), dir(t+delta))` is position-
 * independent (`1/3 + 2/3*cos(TAU*delta)`), including at the wrap. Sunrise is t=0, noon t=3/8, sunset
 * t=3/4. The vector is unit length by construction.
 */
export function sun_dir_from_tod(tod: number, out = new Vector3(), azimuth = 0): Vector3 {
  const angle = tod * TAU + ORBIT_PHASE
  const sin_angle = Math.sin(angle)
  const x = ORBIT_RADIUS * Math.cos(angle)
  const z = ORBIT_CENTER - ORBIT_VERTICAL * sin_angle
  const cos = Math.cos(azimuth),
    sin = Math.sin(azimuth)
  return out.set(x * cos + z * sin, ORBIT_CENTER + ORBIT_VERTICAL * sin_angle, z * cos - x * sin)
}
