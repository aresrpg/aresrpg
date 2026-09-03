// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable functional/immutable-data, functional/prefer-immutable-types, no-param-reassign -- collision probes are caller-owned scratch vectors mutated in this measured hot path. */
// Capsule-vs-voxel collision resolution — LOSSLESS PORT of the proven legacy solver
// (deprecated/engine/src/player/collision.js). Pure math, no renderer coupling: the player is an
// axis-aligned box around a feet-centre against a `solid(x, y, z)` voxel oracle. Single home for
// "don't walk through blocks, climb a 1-block step, slide along walls, don't tunnel at sprint".

export type SolidFn = (x: number, y: number, z: number) => boolean
export type Vec3Mut = [number, number, number]
export type CapsuleSpec = Readonly<{ radius?: number; height?: number }>
export type MoveResult = Readonly<{
  position: Vec3Mut
  velocity: Vec3Mut
  on_ground: boolean
  hit_ceiling: boolean
  stepped: boolean
}>

export const CHARACTER_HEIGHT = 2.0
export const CHARACTER_COLLIDER_HEIGHT = CHARACTER_HEIGHT - 0.1
export const CHARACTER_RADIUS = 0.4

/** Max vertical block-height auto-climbed without jumping (slightly over 1.0 for float headroom). */
export const AUTO_STEP_HEIGHT = 1.05
/** Corner forgiveness: slip sideways around a corner blocked by ≤ this lateral overlap. */
export const CORNER_NUDGE = 0.3
const NUDGE_PROBE = 0.05
/** Skin width kept between the box and resolved faces (kills grid-line flicker under float error). */
const SKIN = 1e-3
/** Sub-step ceiling per axis move — a sprint or frame hitch can never leap a 1-block wall. */
const MAX_STEP_M = 0.5

export const box_overlaps_solid = (
  solid: SolidFn,
  px: number,
  py: number,
  pz: number,
  r: number,
  h: number
): boolean => {
  const min_x = Math.floor(px - r + SKIN)
  const max_x = Math.floor(px + r - SKIN)
  const min_y = Math.floor(py + SKIN)
  const max_y = Math.floor(py + h - SKIN)
  const min_z = Math.floor(pz - r + SKIN)
  const max_z = Math.floor(pz + r - SKIN)
  for (let y = min_y; y <= max_y; y += 1)
    for (let z = min_z; z <= max_z; z += 1) for (let x = min_x; x <= max_x; x += 1) if (solid(x, y, z)) return true
  return false
}

const snap_to_face = (
  solid: SolidFn,
  from: number,
  to: number,
  axis: 0 | 1 | 2,
  probe: Vec3Mut,
  r: number,
  h: number
): number => {
  let lo = from // known clear
  let hi = to // known blocked
  for (let i = 0; i < 12; i += 1) {
    const mid = (lo + hi) / 2
    probe[axis] = mid
    if (box_overlaps_solid(solid, probe[0], probe[1], probe[2], r, h)) hi = mid
    else lo = mid
  }
  probe[axis] = lo
  return lo
}

const move_axis = (
  solid: SolidFn,
  pos: Readonly<Vec3Mut>,
  axis: 0 | 1 | 2,
  delta: number,
  r: number,
  h: number
): Readonly<{ value: number; blocked: boolean }> => {
  if (delta === 0) return { value: pos[axis], blocked: false }
  const sign = Math.sign(delta)
  let remaining = Math.abs(delta)
  const probe: Vec3Mut = [pos[0], pos[1], pos[2]]
  let blocked = false
  while (remaining > 0) {
    const step = Math.min(remaining, MAX_STEP_M)
    remaining -= step
    const next = probe[axis] + sign * step
    const saved = probe[axis]
    probe[axis] = next
    if (box_overlaps_solid(solid, probe[0], probe[1], probe[2], r, h)) {
      probe[axis] = snap_to_face(solid, saved, next, axis, probe, r, h)
      blocked = true
      break
    }
  }
  return { value: probe[axis], blocked }
}

const try_step_up = (
  solid: SolidFn,
  pos: Readonly<Vec3Mut>,
  axis: 0 | 2,
  delta: number,
  r: number,
  h: number
): Readonly<{ x: number; y: number; z: number }> | null => {
  const lifted: Vec3Mut = [pos[0], pos[1] + AUTO_STEP_HEIGHT, pos[2]]
  if (box_overlaps_solid(solid, lifted[0], lifted[1], lifted[2], r, h)) return null // low ceiling
  const horiz = move_axis(solid, lifted, axis, delta, r, h)
  if (horiz.blocked) return null // still a wall one block up ⇒ a ≥2-block wall, not a step
  lifted[axis] = horiz.value
  const drop = move_axis(solid, lifted, 1, -AUTO_STEP_HEIGHT, r, h)
  if (!drop.blocked) return null // no ground within step range → a gap/lip, don't float
  lifted[1] = drop.value
  return { x: lifted[0], y: lifted[1], z: lifted[2] }
}

const try_corner_nudge = (
  solid: SolidFn,
  pos: Readonly<Vec3Mut>,
  axis: 0 | 2,
  delta: number,
  r: number,
  h: number
): Vec3Mut | null => {
  const budget = Math.abs(delta)
  if (budget < 1e-6) return null
  const perp = axis === 0 ? 2 : 0
  for (const sign of [1, -1]) {
    for (let off = NUDGE_PROBE; off <= CORNER_NUDGE + 1e-9; off += NUDGE_PROBE) {
      const probe: Vec3Mut = [pos[0], pos[1], pos[2]]
      probe[perp] += sign * off
      if (box_overlaps_solid(solid, probe[0], probe[1], probe[2], r, h)) break // wall on this side
      if (move_axis(solid, probe, axis, delta, r, h).blocked) continue // not enough clearance yet
      const lateral = Math.min(off, budget)
      const out: Vec3Mut = [pos[0], pos[1], pos[2]]
      out[perp] += sign * lateral
      if (box_overlaps_solid(solid, out[0], out[1], out[2], r, h)) return null // partial spot fouled
      const ahead = move_axis(solid, out, axis, Math.sign(delta) * (budget - lateral), r, h)
      out[axis] = ahead.value
      return out
    }
  }
  return null
}

/** Axis-separated resolve (X, Z, then Y — horizontal tries step-up before Y settles). */
export const resolve_movement = (
  solid: SolidFn,
  position: Readonly<Vec3Mut>,
  velocity: Readonly<Vec3Mut>,
  dt: number,
  spec: CapsuleSpec = {}
): MoveResult => {
  const r = spec.radius ?? CHARACTER_RADIUS
  const h = spec.height ?? CHARACTER_COLLIDER_HEIGHT
  const vel: Vec3Mut = [velocity[0], velocity[1], velocity[2]]
  const pos: Vec3Mut = [position[0], position[1], position[2]]
  let stepped = false

  const dx = vel[0] * dt
  const rx = move_axis(solid, pos, 0, dx, r, h)
  if (rx.blocked) {
    const climbed = try_step_up(solid, pos, 0, dx, r, h)
    if (climbed !== null) {
      pos[0] = climbed.x
      pos[1] = climbed.y
      stepped = true
    } else {
      const nudged = try_corner_nudge(solid, pos, 0, dx, r, h)
      if (nudged !== null) {
        ;[pos[0], , pos[2]] = nudged // velocity preserved — slipping a corner, not hitting a wall
      } else {
        pos[0] = rx.value
        vel[0] = 0 // wall on X — Z may still slide (wall slide)
      }
    }
  } else pos[0] = rx.value

  const dz = vel[2] * dt
  const rz = move_axis(solid, pos, 2, dz, r, h)
  if (rz.blocked) {
    const climbed = try_step_up(solid, pos, 2, dz, r, h)
    if (climbed !== null) {
      pos[2] = climbed.z
      pos[1] = climbed.y
      stepped = true
    } else {
      const nudged = try_corner_nudge(solid, pos, 2, dz, r, h)
      if (nudged !== null) {
        ;[pos[0], , pos[2]] = nudged
      } else {
        pos[2] = rz.value
        vel[2] = 0
      }
    }
  } else pos[2] = rz.value

  const dy = vel[1] * dt
  const ry = move_axis(solid, pos, 1, dy, r, h)
  let on_ground = false
  let hit_ceiling = false
  if (ry.blocked) {
    pos[1] = ry.value
    if (dy < 0)
      on_ground = true // stopped while descending → landed
    else if (dy > 0) hit_ceiling = true
    vel[1] = 0
  } else pos[1] = ry.value

  // Resting contact: solid within the skin under the feet still counts as grounded.
  if (!on_ground && vel[1] <= 0 && box_overlaps_solid(solid, pos[0], pos[1] - 2 * SKIN, pos[2], r, h)) on_ground = true

  return { position: pos, velocity: vel, on_ground, hit_ceiling, stepped }
}

export const ground_height_below = (
  solid: SolidFn,
  px: number,
  py: number,
  pz: number,
  max_drop = 64
): number | null => {
  const start = Math.floor(py)
  for (let y = start; y >= start - max_drop; y -= 1) if (solid(Math.floor(px), y, Math.floor(pz))) return y + 1
  return null
}

/** A collisionless follower stays on the same vertical world layer as its owner. This keeps it
 * on bridges and roofs while the terrain height remains the fallback before structures load. */
export const following_pet_ground_height = (
  solid: SolidFn,
  px: number,
  pz: number,
  owner_y: number,
  terrain_y: number
): number => ground_height_below(solid, px, owner_y, pz, 256) ?? terrain_y

/** Lowest standable air pocket at or above authored terrain. A floor plus a tall-enough room
 * wins over its roof; a wall, trunk, or cramped cavity lifts the spawn above the obstruction. */
export const walkable_spawn_height = (
  solid: SolidFn,
  px: number,
  base_y: number,
  pz: number,
  clearance = 3,
  max_rise = 32
): number => {
  const x = Math.floor(px)
  const z = Math.floor(pz)
  const start = Math.floor(base_y)
  for (let y = start; y <= start + max_rise; y += 1) {
    if (!solid(x, y - 1, z)) continue
    let clear = true
    for (let offset = 0; offset < clearance; offset += 1)
      if (solid(x, y + offset, z)) {
        clear = false
        break
      }
    if (clear) return y
  }
  return base_y
}

export const EJECT_MAX_UP = 32
export const EJECT_RING = 2

const EJECT_LATERAL_OFFSETS: readonly (readonly [number, number])[] = (() => {
  const out: [number, number][] = []
  for (let dx = -EJECT_RING; dx <= EJECT_RING; dx += 1)
    for (let dz = -EJECT_RING; dz <= EJECT_RING; dz += 1) if (dx || dz) out.push([dx, dz])
  return out.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]))
})()

/** Stuck-in-block auto-eject: nearest clear feet position (same column up, then the 5×5 ring). */
export const eject_from_solid = (solid: SolidFn, position: Readonly<Vec3Mut>, spec: CapsuleSpec = {}): Vec3Mut => {
  const r = spec.radius ?? CHARACTER_RADIUS
  const h = spec.height ?? CHARACTER_COLLIDER_HEIGHT
  const [px, py, pz] = position
  if (!box_overlaps_solid(solid, px, py, pz, r, h)) return [px, py, pz]
  for (let dy = 1; dy <= EJECT_MAX_UP; dy += 1)
    if (!box_overlaps_solid(solid, px, py + dy, pz, r, h)) return [px, py + dy, pz]
  for (let dy = 0; dy <= EJECT_MAX_UP; dy += 1)
    for (const [dx, dz] of EJECT_LATERAL_OFFSETS)
      if (!box_overlaps_solid(solid, px + dx, py + dy, pz + dz, r, h)) return [px + dx, py + dy, pz + dz]
  console.warn(
    `[voxel] eject failed: capsule at [${position.map((v) => +v.toFixed(1)).join(', ')}] found no air within ` +
      `${EJECT_MAX_UP} up / ${EJECT_RING * 2 + 1}² ring — left in place`
  )
  return [px, py, pz]
}
