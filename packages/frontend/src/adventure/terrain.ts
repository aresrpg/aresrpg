// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { create_fbm_sampler, landscape_height } from '@aresrpg/engine'

import environment from '../../../../seed/content/adventure_environment.json'
import adventure from '../../../../seed/content/adventure.json'

export const ADVENTURE_SPAWN = Object.freeze(environment.spawn)
export const ADVENTURE_GATE = Object.freeze({ min_z: 148, max_z: 154 })
const path_center = environment.path.center.map(([x, y]) => [x!, y!] as const)
export const adventure_axis = (z: number): number => landscape_height(path_center, z)
const descent_elevations = environment.descent.floor.map(([z, y]) => [z!, y!] as const)
export const cavern_floor = (z: number): number => Math.floor(landscape_height(descent_elevations, Math.floor(z)))

export const adventure_noise = create_fbm_sampler(617, { period: 19, octaves: 3, gain: 0.55 })
const path_radius = environment.path.radius.map(([x, y]) => [x!, y!] as const)
export const adventure_path_radius = (z: number): number => landscape_height(path_radius, z)

const plan = environment.descent
const throne = adventure.encounters.at(-1)!.position

/** The same invisible boundary as the opening keeps both heroes off the lava and cliff edges. */
const cavern_movement_area = (x: number, z: number): boolean =>
  Math.hypot(x - throne.x, z - throne.z) < plan.arena_radius - 1 ||
  (z <= throne.z && Math.abs(x - adventure_axis(z)) < 3.5)

/** Invisible movement boundary follows the authored path without changing terrain. */
export const adventure_movement_area =
  (unlocked: boolean) =>
  (x: number, z: number): boolean => {
    if (z >= environment.descent.start_z) return unlocked && cavern_movement_area(x, z)
    const radius = z < 180 ? Math.max(3, adventure_path_radius(z) - 4) : 3.5
    return z >= 100 && (unlocked || z < ADVENTURE_GATE.min_z) && Math.abs(x - adventure_axis(z)) < radius
  }

export const adventure_floor = (world_x: number, world_z: number): number => {
  if (world_z >= environment.descent.start_z) return cavern_floor(world_z)
  const x = Math.floor(world_x)
  const z = Math.floor(world_z)
  const route = landscape_height(
    [
      [96, 72],
      [140, 72],
      [150, 73],
      [172, 76],
    ],
    z
  )
  const edge = Math.max(0, Math.abs(x - adventure_axis(z)) - 4)
  return Math.floor(route + edge * (0.16 + adventure_noise(x, z) * 0.3))
}
