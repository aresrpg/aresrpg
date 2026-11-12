// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  AUTO_STEP_HEIGHT,
  CHARACTER_RADIUS,
  CHARACTER_COLLIDER_HEIGHT,
  box_overlaps_solid,
  resolve_movement,
  type SolidFn,
} from './collision.ts'

export type WalkPoint = readonly [number, number, number]
export type WalkWorld = Readonly<{
  solid_at: SolidFn
  liquid_at: SolidFn
  ground_height: (x: number, z: number, anchor_y?: number) => number
  ready: (area: Readonly<{ min_x: number; max_x: number; min_z: number; max_z: number }>) => boolean
}>

/** Undefined is unknown terrain; null is an impassable walking edge. The real collision
 * solver owns body clearance, steps and wall contact. Walking never assumes a jump or swim. */
export const walking_edge = (world: WalkWorld, from: WalkPoint, x: number, z: number): WalkPoint | null | undefined => {
  if (
    !world.ready({
      min_x: Math.min(from[0], x) - 1,
      max_x: Math.max(from[0], x) + 1,
      min_z: Math.min(from[2], z) - 1,
      max_z: Math.max(from[2], z) + 1,
    })
  )
    return undefined
  if (box_overlaps_solid(world.solid_at, ...from, CHARACTER_RADIUS, CHARACTER_COLLIDER_HEIGHT)) return null
  const steps = Math.max(1, Math.ceil(Math.hypot(x - from[0], z - from[2]) / 0.25))
  let point: WalkPoint = from
  for (let index = 1; index <= steps; index += 1) {
    const next_x = from[0] + ((x - from[0]) * index) / steps
    const next_z = from[2] + ((z - from[2]) * index) / steps
    const horizontal = resolve_movement(world.solid_at, point, [next_x - point[0], 0, next_z - point[2]], 1)
    const landed = resolve_movement(world.solid_at, horizontal.position, [0, -AUTO_STEP_HEIGHT, 0], 1)
    if (
      !landed.on_ground ||
      Math.hypot(landed.position[0] - next_x, landed.position[2] - next_z) > 0.01 ||
      world.liquid_at(next_x, landed.position[1], next_z)
    )
      return null
    point = landed.position
  }
  return point
}
