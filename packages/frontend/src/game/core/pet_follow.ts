// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { PET_SPEED_MULTIPLIER } from '@aresrpg/protocol'

import { RUN_SPEED } from './controller.ts'

export type PetMotion = Readonly<{
  x: number
  z: number
  yaw: number
  target_x: number
  target_z: number
  /** the QUEUED next goal (capacity 1, last decision wins) — a walk never changes course,
   *  but the 1 Hz decisions keep running and park their outcome here; arrival promotes it */
  next_x: number
  next_z: number
  moving: boolean
  /** seconds until the next follow DECISION — the pet re-evaluates its leash every
   *  DECISION_SECONDS (owner 2026-08-21: calm follower, never a per-frame chaser) */
  check_in: number
}>

const DEAD_ZONE = 5
/** one leash decision every 500ms — motion between decisions stays committed and smooth
 *  (owner 2026-08-21: down from 1s — snappier follow, still never a per-frame chaser) */
const DECISION_SECONDS = 0.5
/** the pet catches up at 1.5× the player's run — the SAME multiplier the mount law rides */
const CHASE_SPEED = RUN_SPEED * PET_SPEED_MULTIPLIER
const SNAP_DISTANCE = 30
/** past 40 blocks the pet TELEPORTS instantly — the one rule that overrides a committed walk */
const TELEPORT_DISTANCE = 40
const SNAP_LAND = 3
const TARGET_RADIUS_MIN = 2
const TARGET_RADIUS_MAX = 4
const ARRIVAL_DISTANCE = 0.05

export const empty_pet_motion = (): PetMotion =>
  Object.freeze({
    x: Number.NaN,
    z: Number.NaN,
    yaw: 0,
    target_x: Number.NaN,
    target_z: Number.NaN,
    next_x: Number.NaN,
    next_z: Number.NaN,
    moving: false,
    check_in: 0,
  })

const follow_target = (x: number, z: number, random: () => number) => {
  const angle = random() * Math.PI * 2
  const radius = TARGET_RADIUS_MIN + random() * (TARGET_RADIUS_MAX - TARGET_RADIUS_MIN)
  return Object.freeze({
    target_x: Math.floor(x + Math.cos(angle) * radius) + 0.5,
    target_z: Math.floor(z + Math.sin(angle) * radius) + 0.5,
  })
}

const toward = (x: number, z: number, target_x: number, target_z: number, speed: number, seconds: number) => {
  const dx = target_x - x
  const dz = target_z - z
  const distance = Math.hypot(dx, dz)
  if (distance < 0.000_001) return Object.freeze({ x, z, moved: 0 })
  const step = Math.min(speed * seconds, distance)
  return Object.freeze({ x: x + (dx / distance) * step, z: z + (dz / distance) * step, moved: step })
}

export const step_pet_follow = (
  motion: PetMotion,
  owner: Readonly<{ x: number; z: number }>,
  seconds: number,
  random: () => number = Math.random
): PetMotion => {
  if (!Number.isFinite(motion.x) || !Number.isFinite(motion.z))
    return Object.freeze({ ...empty_pet_motion(), x: owner.x, z: owner.z })
  const dx = owner.x - motion.x
  const dz = owner.z - motion.z
  const distance = Math.hypot(dx, dz)
  if (distance > TELEPORT_DISTANCE)
    return Object.freeze({
      ...motion,
      x: owner.x - (dx / distance) * SNAP_LAND,
      z: owner.z - (dz / distance) * SNAP_LAND,
      yaw: Math.atan2(dx, dz),
      target_x: Number.NaN,
      target_z: Number.NaN,
      next_x: Number.NaN,
      next_z: Number.NaN,
      moving: false,
      check_in: DECISION_SECONDS,
    })
  // THE DECISION CLOCK NEVER STOPS (owner 2026-08-21): a committed walk never changes course,
  // but each decision tick still runs — its outcome parks in the queue (capacity 1, last wins)
  // and the arrival promotes it. Idle decisions act immediately; the snap only fires idle.
  const committed = Number.isFinite(motion.target_x) && Number.isFinite(motion.target_z)
  const check_in = motion.check_in - seconds
  const deciding = check_in <= 0
  if (!committed && !deciding) return Object.freeze({ ...motion, moving: false, check_in })
  if (!committed && deciding) {
    if (distance > SNAP_DISTANCE) {
      return Object.freeze({
        ...motion,
        x: owner.x - (dx / distance) * SNAP_LAND,
        z: owner.z - (dz / distance) * SNAP_LAND,
        yaw: Math.atan2(dx, dz),
        target_x: Number.NaN,
        target_z: Number.NaN,
        next_x: Number.NaN,
        next_z: Number.NaN,
        moving: false,
        check_in: DECISION_SECONDS,
      })
    }
    if (distance <= DEAD_ZONE)
      return Object.freeze({
        ...motion,
        target_x: Number.NaN,
        target_z: Number.NaN,
        next_x: Number.NaN,
        next_z: Number.NaN,
        moving: false,
        check_in: DECISION_SECONDS,
      })
  }
  // a mid-walk decision QUEUES: outside the dead zone a fresh goal (last wins), inside it
  // clears the queue — the walk in progress is never redirected
  const queued =
    committed && deciding
      ? distance > DEAD_ZONE
        ? follow_target(owner.x, owner.z, random)
        : Object.freeze({ target_x: Number.NaN, target_z: Number.NaN })
      : Object.freeze({ target_x: motion.next_x, target_z: motion.next_z })
  const target = committed
    ? Object.freeze({ target_x: motion.target_x, target_z: motion.target_z })
    : follow_target(owner.x, owner.z, random)
  const target_distance = Math.hypot(target.target_x - motion.x, target.target_z - motion.z)
  const next = toward(motion.x, motion.z, target.target_x, target.target_z, CHASE_SPEED, seconds)
  const arrived = target_distance - next.moved <= ARRIVAL_DISTANCE
  // arrival promotes the queued goal — the pet flows into its next walk without an idle beat
  const promote = arrived && Number.isFinite(queued.target_x) && Number.isFinite(queued.target_z)
  return Object.freeze({
    ...motion,
    x: next.x,
    z: next.z,
    yaw: next.moved > 0.000_1 ? Math.atan2(next.x - motion.x, next.z - motion.z) : motion.yaw,
    target_x: arrived ? (promote ? queued.target_x : Number.NaN) : target.target_x,
    target_z: arrived ? (promote ? queued.target_z : Number.NaN) : target.target_z,
    next_x: arrived ? Number.NaN : queued.target_x,
    next_z: arrived ? Number.NaN : queued.target_z,
    moving: (!arrived || promote) && next.moved > 0.000_1,
    check_in: deciding ? DECISION_SECONDS : arrived && !promote ? DECISION_SECONDS : check_in,
  })
}
