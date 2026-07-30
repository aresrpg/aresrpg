// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #593 — PET FOLLOW STEERING (pure core). The pet is a NORMAL independent world entity, not a rig welded to
// a character transform: it keeps its OWN world position and steers toward the follow target with a dead zone. This is
// the SAME beeline-with-arrival-radius pattern auto_run.js already ships for "make the character auto run
// towards it" (steer_to + is_arrived, auto_run.js:29 ARRIVE_RADIUS_M) — reused, not reinvented: is_arrived is
// the dead-zone gate here. The only difference is actuation — auto_run feeds controller input, the pet moves
// its OWN rig position at its own speed (a cosmetic companion, never a controller-driven character).
//
// The spec (#593): ① target = the character position; ② a 5-block DEAD ZONE — within it the pet does NOT
// chase; ③ beyond it, catch up at its own speed; ④ inside the zone it roams in small idle wanders so it reads
// as alive (seedable — the rng is injected, Math.random at the edge); ⑤ hopelessly far ⇒ snap-catch-up. No
// voxel-collision agonizing: a straight line, the same tolerance the character auto-follow accepts.
//
// PURE by law — no @aresrpg/engine3 / GLB import (so the whole contract unit-tests in the public checkout,
// issue #117). `step_pet_follow(motion, owner, dt, rng) → motion` is the one reducer for the pet's position;
// pet_companion.js's rig holds the motion state and applies the result to three.js at the effect edge.

import { is_arrived } from './auto_run.js'

export const DEAD_ZONE_M = 5 // within ~5 blocks of the target the pet does not chase (the spec's dead zone)
export const CHASE_SPEED = 12 // m/s — the pet's own catch-up pace, above RUN_SPEED (10.5) so it closes on a runner
export const SNAP_FAR_M = 30 // beyond this the pet is hopelessly far (fast-travel / teleport / long desync)…
export const SNAP_LAND_M = 3 // …and snap-catches-up to here from the target, inside the dead zone, on its approach side
export const ROAM_RADIUS_M = 2 // idle wanders stay within this disc of the target (well inside the dead zone)
export const ROAM_SPEED = 1.3 // m/s — a gentle amble (WALK_SPEED is 4.8), so the wander reads as idle, not travel
export const ROAM_INTERVAL_MIN_S = 1.4 // seconds between picking a new wander point…
export const ROAM_INTERVAL_MAX_S = 3.6 // …randomised so the wander doesn't tick like a metronome
const FACE_EPS = 1e-4 // below this per-step travel the pet keeps its facing (no idle spin)

/** Fresh motion state for a newly-spawned pet: position seeds on the target on the first finite frame. */
export const empty_pet_motion = () => ({ x: NaN, z: NaN, yaw: 0, roam_x: NaN, roam_z: NaN, roam_cd: 0 })

/**
 * A new idle-wander target uniformly inside the ROAM_RADIUS disc around the target, plus the next interval.
 * sqrt(rng) on the radius keeps points uniform over the disc (never clustered at the centre).
 * @param {{ x: number, z: number }} owner @param {() => number} rng
 */
const pick_roam = (owner, rng) => {
  const angle = rng() * Math.PI * 2
  const radius = Math.sqrt(rng()) * ROAM_RADIUS_M
  return {
    roam_x: owner.x + Math.cos(angle) * radius,
    roam_z: owner.z + Math.sin(angle) * radius,
    roam_cd: ROAM_INTERVAL_MIN_S + rng() * (ROAM_INTERVAL_MAX_S - ROAM_INTERVAL_MIN_S),
  }
}

/**
 * Move (x,z) straight at (tx,tz) at `speed` m/s, never overshooting the target.
 * @returns {{ x: number, z: number, moved: number }} the new spot + the distance travelled this step
 */
const step_toward = (x, z, tx, tz, speed, dt) => {
  const dx = tx - x
  const dz = tz - z
  const d = Math.hypot(dx, dz)
  if (d < 1e-6) return { x, z, moved: 0 }
  const step = Math.min(speed * dt, d)
  return { x: x + (dx / d) * step, z: z + (dz / d) * step, moved: step }
}

/** Facing from an actual move delta (world convention, matching remote_players.js), or the last yaw when idle. */
const face = (nx, nz, ox, oz, moved, prev_yaw) => (moved > FACE_EPS ? Math.atan2(nx - ox, nz - oz) : prev_yaw)

/**
 * One pure steering step for a trailing pet. Given its current motion, the target position and dt, returns
 * the next motion — dead-zone-gated so the pet only chases past DEAD_ZONE_M and roams (seedably) within it.
 * @param {ReturnType<typeof empty_pet_motion>} motion the pet's own world position + wander state
 * @param {{ x: number, z: number }} owner the character's world position (the follow target)
 * @param {number} dt seconds since the last step
 * @param {() => number} [rng] deterministic [0,1) source — Math.random at the edge, a seed in tests
 * @returns {ReturnType<typeof empty_pet_motion>}
 */
export function step_pet_follow(motion, owner, dt, rng = Math.random) {
  // First finite frame — spawn ON the target (then it ambles out) instead of sliding in from NaN/origin.
  if (!Number.isFinite(motion.x) || !Number.isFinite(motion.z))
    return { ...motion, ...pick_roam(owner, rng), x: owner.x, z: owner.z }

  const dx = owner.x - motion.x
  const dz = owner.z - motion.z
  const dist = Math.hypot(dx, dz)

  // ⑤ hopelessly far (fast-travel, teleport, long desync) → snap-catch-up to just inside the dead zone, on the
  //   side it was approaching from; re-seed the wander so it settles cleanly.
  if (dist > SNAP_FAR_M) {
    const ux = dx / dist
    const uz = dz / dist
    return {
      ...motion,
      ...pick_roam(owner, rng),
      x: owner.x - ux * SNAP_LAND_M,
      z: owner.z - uz * SNAP_LAND_M,
      yaw: Math.atan2(ux, uz),
    }
  }

  // ①② inside the 5-block dead zone → do NOT chase; roam in small idle wanders (auto_run's is_arrived gate).
  if (is_arrived(dist, DEAD_ZONE_M)) {
    let { roam_x, roam_z, roam_cd } = motion
    roam_cd -= dt
    if (roam_cd <= 0 || !Number.isFinite(roam_x)) ({ roam_x, roam_z, roam_cd } = pick_roam(owner, rng))
    const next = step_toward(motion.x, motion.z, roam_x, roam_z, ROAM_SPEED, dt)
    return {
      x: next.x,
      z: next.z,
      yaw: face(next.x, next.z, motion.x, motion.z, next.moved, motion.yaw),
      roam_x,
      roam_z,
      roam_cd,
    }
  }

  // ③ beyond the dead zone → catch up at the pet's own speed (straight line, no pathfinding); disarm the
  //   wander so a fresh point is picked the moment it re-enters the zone.
  const next = step_toward(motion.x, motion.z, owner.x, owner.z, CHASE_SPEED, dt)
  return {
    x: next.x,
    z: next.z,
    yaw: face(next.x, next.z, motion.x, motion.z, next.moved, motion.yaw),
    roam_x: NaN,
    roam_z: NaN,
    roam_cd: 0,
  }
}
