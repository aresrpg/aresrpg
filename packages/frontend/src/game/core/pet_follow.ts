// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export type PetMotion = Readonly<{
  x: number
  z: number
  yaw: number
  target_x: number
  target_z: number
  moving: boolean
}>

const DEAD_ZONE = 5
const CHASE_SPEED = 12
const SNAP_DISTANCE = 30
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
    moving: false,
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
  if (distance > SNAP_DISTANCE) {
    return Object.freeze({
      ...motion,
      x: owner.x - (dx / distance) * SNAP_LAND,
      z: owner.z - (dz / distance) * SNAP_LAND,
      yaw: Math.atan2(dx, dz),
      target_x: Number.NaN,
      target_z: Number.NaN,
      moving: false,
    })
  }
  if (distance <= DEAD_ZONE)
    return Object.freeze({ ...motion, target_x: Number.NaN, target_z: Number.NaN, moving: false })
  const target =
    Number.isFinite(motion.target_x) && Number.isFinite(motion.target_z)
      ? Object.freeze({ target_x: motion.target_x, target_z: motion.target_z })
      : follow_target(owner.x, owner.z, random)
  const target_distance = Math.hypot(target.target_x - motion.x, target.target_z - motion.z)
  if (target_distance <= ARRIVAL_DISTANCE)
    return Object.freeze({ ...motion, target_x: Number.NaN, target_z: Number.NaN, moving: false })
  const next = toward(motion.x, motion.z, target.target_x, target.target_z, CHASE_SPEED, seconds)
  const arrived = target_distance - next.moved <= ARRIVAL_DISTANCE
  return Object.freeze({
    ...motion,
    x: next.x,
    z: next.z,
    yaw: next.moved > 0.000_1 ? Math.atan2(next.x - motion.x, next.z - motion.z) : motion.yaw,
    target_x: arrived ? Number.NaN : target.target_x,
    target_z: arrived ? Number.NaN : target.target_z,
    moving: !arrived && next.moved > 0.000_1,
  })
}
