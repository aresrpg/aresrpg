// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FAST-TRAVEL FLIGHT — the PURE autopilot math (headless, unit-tested): a per-frame integration step that
// beelines the dragon to the target at RUN speed and shapes altitude (climb → cruise ground+12 → descend
// ground+3), plus the arrival test. NO effects, NO engine handles — the browserful edge (fast_travel_pilot.js)
// feeds it position + a ground sample and applies the returned position via ctl.teleport, exactly as the TR-1
// creative-fly branch hard-places a per-frame position (embed_voxel_player.js:427-435).
//
// SPEED IS LOAD-BEARING (plan §2-⑦ travel-debt): the dragon flies at RUN_SPEED × 1.0 — the SAME budget a
// runner covers, so the traveler's next on-chain action at the destination passes the chain speed clock exactly
// as if they ran. RUN_SPEED comes from the controller's ONE home (never a literal); ×1.5 (mount roam speed)
// would break arrival interactions and is FORBIDDEN here (plan invariant 1).

import { CONTROLLER_CONSTANTS } from '@aresrpg/engine3/player'

import { steer_to } from './auto_run.js'

export const FT_SPEED = CONTROLLER_CONSTANTS.RUN_SPEED // m/s — never ×1.5 (plan invariant 1); single home
// #175 second live report ("it should fly WAY higher", priority bumped on recurrence): 12 read as skimming
// the treetops. 30 = 2.5× the old cruise (owner range: 2-3×) — terrain-follow, so it clears whatever peak
// sits under the path by the same margin everywhere. DESCEND_RADIUS is widened to match (see below) so the
// extra altitude still fully sheds into LAND_CLEARANCE before arrival — a taller cruise with the OLD 30-block
// descent window would have force-unmounted the rider mid-air (see the paired invariant test).
export const CRUISE_CLEARANCE = 30 // m above the sampled ground during cruise (terrain-follow — clears any peak)
export const LAND_CLEARANCE = 3 // m above ground at the drop point — force-unmount from here, gravity settles the rest
// Widened alongside CRUISE_CLEARANCE (was 30, sized for the old ground+12 cruise): the descent must shed
// CRUISE_CLEARANCE−LAND_CLEARANCE metres at VERT_RATE before the dragon reaches ARRIVAL_RADIUS, which bounds
// the MINIMUM viable radius to FT_SPEED·(CRUISE_CLEARANCE−LAND_CLEARANCE)/VERT_RATE ≈ 47; 50 keeps a margin.
export const DESCEND_RADIUS = 50 // begin the cruise→land descent within this XZ distance of the target…
export const ARRIVAL_RADIUS = 4 // …and count as arrived (drop) within this XZ distance (the dragon rig is large)
export const VERT_RATE = 6 // m/s vertical shaping rate (climb + descend) — smooth, never a Y teleport

/** Target vertical clearance above ground for the current XZ distance: cruise far out, descend near. Descent
 *  begins at DESCEND_RADIUS (>> ARRIVAL_RADIUS) so the body is already at LAND_CLEARANCE by arrival.
 *  @param {number} dist @returns {number} */
export function target_clearance(dist) {
  return dist <= DESCEND_RADIUS ? LAND_CLEARANCE : CRUISE_CLEARANCE
}

// #175 root cause (both live reports: "still not animated"): the pilot drives the body via ctl.teleport()
// every frame, never ctl.tick() — and teleport() ZEROES the controller's velocity (character_controller.js),
// so state.speed is never recomputed while flying (step_controller, the only writer, only runs inside tick).
// A raw `speed > threshold` moving-check therefore reads the dragon as motionless for the WHOLE flight, so
// mount_rig.js's idle↔move blend decays to idle (weight→1) and the flap/fly clip never gets weight — the
// mixer IS running, the WRONG clip just wins. The fix is this one gate: fast-travel flight is unconditional
// motion for animation purposes, independent of the controller's (frozen) own speed reading.
export const MOUNT_MOVE_THRESHOLD = 0.2 // m/s — the mount_rig.js idle↔move blend gate for ordinary riding

/** Is the ridden mount considered "moving" for the idle↔move animation blend (mount_rig.js)? Real ground
 *  speed OR an active fast-travel flight — see the note above for why speed alone lies mid-flight.
 *  @param {number} speed @param {boolean} flying @returns {boolean} */
export function mount_is_moving(speed, flying) {
  return speed > MOUNT_MOVE_THRESHOLD || flying
}

/** Arrived once within ARRIVAL_RADIUS blocks of the target (XZ). @param {number} dist @param {number} [radius] */
export function is_arrived(dist, radius = ARRIVAL_RADIUS) {
  return dist <= radius
}

/**
 * One autopilot frame. Beelines XZ toward the target at ≤ FT_SPEED·dt (never overshoots) and shapes Y toward
 * ground+clearance at ≤ VERT_RATE·dt. A null ground sample (column not streamed yet) HOLDS the current altitude —
 * never descend blind (plan §4-B8).
 * @param {{ pos:[number,number,number], target:{x:number,z:number}, ground_y:number|null, dt:number }} a
 * @returns {{ pos:[number,number,number], yaw:number, dist:number, arrived:boolean, descending:boolean }}
 */
export function flight_step({ pos, target, ground_y, dt }) {
  const [px, py, pz] = pos
  const step_dt = Math.max(dt, 0)
  const { yaw, dist } = steer_to(px, pz, target.x, target.z)
  // XZ beeline — advance by min(speed·dt, remaining) along the steer heading, so we plant exactly on the
  // target and never overshoot. steer_to's yaw sends forward=1 along (-sin, -cos) = the unit dir to the target.
  const step = Math.min(FT_SPEED * step_dt, dist)
  const nx = dist > 1e-6 ? px + -Math.sin(yaw) * step : px
  const nz = dist > 1e-6 ? pz + -Math.cos(yaw) * step : pz
  // Y shaping — glide toward ground+clearance, bounded by VERT_RATE·dt (smooth climb/descent, never a Y jump).
  // A null ground sample (column not streamed yet) holds the current altitude — never descend blind (§4-B8).
  const want_y = ground_y == null ? py : ground_y + target_clearance(dist)
  const dy_cap = VERT_RATE * step_dt
  const ny = py + Math.max(-dy_cap, Math.min(dy_cap, want_y - py))
  return { pos: [nx, ny, nz], yaw, dist, arrived: is_arrived(dist), descending: dist <= DESCEND_RADIUS }
}
