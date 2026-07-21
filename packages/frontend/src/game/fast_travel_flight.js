// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FAST-TRAVEL FLIGHT — the PURE autopilot math (headless, unit-tested): a per-frame integration step that
// beelines the dragon to the target at RUN speed and shapes altitude (climb → flat cruise @ CRUISE_ALTITUDE →
// glide-slope descend → ground+3), plus the arrival test. NO effects, NO engine handles — the browserful edge
// (fast_travel_pilot.js) feeds it position + a ground sample and applies the returned position via ctl.teleport,
// exactly as the TR-1 creative-fly branch hard-places a per-frame position (embed_voxel_player.js:427-435).
//
// SPEED IS LOAD-BEARING (plan §2-⑦ travel-debt): the dragon flies at RUN_SPEED × 1.0 — the SAME budget a
// runner covers, so the traveler's next on-chain action at the destination passes the chain speed clock exactly
// as if they ran. RUN_SPEED comes from the controller's ONE home (never a literal); ×1.5 (mount roam speed)
// would break arrival interactions and is FORBIDDEN here (plan invariant 1).

import { CONTROLLER_CONSTANTS } from '@aresrpg/engine3/player'

import { steer_to } from './auto_run.js'

export const FT_SPEED = CONTROLLER_CONSTANTS.RUN_SPEED // m/s — never ×1.5 (plan invariant 1); single home
// v2 (#370, owner spec verbatim: "static 300 cruise, no heightmap"): the OLD cruise tracked ground+30 the WHOLE
// way, which reads as ground-walking near trees/hills (the .46 live-report screenshot: the dragon skimming
// terrain). CRUISE_ALTITUDE is an ABSOLUTE world Y — flat, terrain-INDEPENDENT — so mid-cruise never touches
// ground_y at all; only the climb-out and the final descent (target_altitude below) still need it.
export const CRUISE_ALTITUDE = 300 // absolute world Y during cruise (v2, #370)
export const LAND_CLEARANCE = 3 // m above ground at the drop point — force-unmount from here, gravity settles the rest
export const ARRIVAL_RADIUS = 4 // count as arrived (drop) within this XZ distance (the dragon rig is large)
export const VERT_RATE = 6 // m/s vertical shaping rate (climb + descend) — smooth, never a Y teleport

/**
 * Absolute target world-Y for the current XZ distance + ground sample: a GLIDE SLOPE, not a fixed-radius
 * trigger. The ceiling is flat CRUISE_ALTITUDE; it's capped by a straight ramp down to ground+LAND_CLEARANCE
 * that reaches EXACTLY that value by dist=ARRIVAL_RADIUS (is_arrived fires there, NOT at dist=0 — the ramp's
 * touchdown point has to match, else "arrived" fires while still mid-glide), descending at EXACTLY VERT_RATE
 * per second of remaining travel — so the flight_step clamp below (≤ VERT_RATE·dt per frame) tracks the slope
 * with ZERO lag once on it, and the crossover point (where cruise ends and the glide begins) auto-scales to
 * however much altitude actually needs to shed. That auto-scaling is why this replaced a fixed DESCEND_RADIUS
 * (#175's shed math assumed a CONSTANT ~27m ground-relative shed; a 300-absolute cruise's shed depends
 * entirely on the destination's terrain height — a mountain-top arrival sheds far less than a sea-level one,
 * and no single fixed radius covers both without either an unbelievably fast dive or a stalled approach still
 * hundreds of metres up at arrival).
 * @param {number} dist @param {number} ground_y @returns {number}
 */
export function target_altitude(dist, ground_y) {
  return Math.min(CRUISE_ALTITUDE, ground_y + LAND_CLEARANCE + (VERT_RATE * Math.max(0, dist - ARRIVAL_RADIUS)) / FT_SPEED)
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
 * target_altitude (flat CRUISE_ALTITUDE far out, glide-slope down to ground+LAND_CLEARANCE near the target) at
 * ≤ VERT_RATE·dt. A null ground sample (column not streamed yet) HOLDS the current altitude — never descend
 * blind (plan §4-B8). yaw is the raw segment/velocity direction toward the target (steer_to) — the caller
 * (fast_travel_pilot.js) owns any frame-to-frame easing; this stays pure and stateless.
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
  // Y shaping — glide toward target_altitude, bounded by VERT_RATE·dt (smooth climb/descent, never a Y jump).
  // A null ground sample (column not streamed yet) holds the current altitude — never descend blind (§4-B8).
  const want_y = ground_y == null ? py : target_altitude(dist, ground_y)
  const dy_cap = VERT_RATE * step_dt
  const ny = py + Math.max(-dy_cap, Math.min(dy_cap, want_y - py))
  // descending = below the flat ceiling (past the glide-slope crossover) — a null ground sample never counts,
  // matching the hold-altitude rule above (we can't be gliding toward a target we didn't sample).
  const descending = ground_y != null && want_y < CRUISE_ALTITUDE
  return { pos: [nx, ny, nz], yaw, dist, arrived: is_arrived(dist), descending }
}
