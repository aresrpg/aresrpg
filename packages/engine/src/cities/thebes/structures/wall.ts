// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  compile_positioned_city_structure,
  type CityBlock,
  type PositionedCityStructure,
} from '../../city_structure.ts'
import type { CompiledWorld } from '../../../world_recipe.ts'
import { sample_world_column } from '../../../world_recipe.ts'
import { THEBES_CELL } from '../plan.ts'
import { THEBES_MATERIALS as M } from '../materials.ts'

export type ThebesWallEdge = 'north' | 'east' | 'south' | 'west'

const wall_position = (
  area: Readonly<{ min_x: number; max_x: number; min_z: number; max_z: number }>,
  edge: ThebesWallEdge,
  segment: number,
  along: number,
  across: number
): readonly [number, number] => {
  if (edge === 'north') return [area.min_x + segment * THEBES_CELL + along, area.min_z + across]
  if (edge === 'south') return [area.min_x + segment * THEBES_CELL + along, area.max_z - across]
  if (edge === 'west') return [area.min_x + across, area.min_z + segment * THEBES_CELL + along]
  return [area.max_x - across, area.min_z + segment * THEBES_CELL + along]
}

const wall_column = (
  world: CompiledWorld,
  area: Readonly<{ min_x: number; max_x: number; min_z: number; max_z: number }>,
  edge: ThebesWallEdge,
  segment: number,
  along: number,
  gate: boolean
): readonly CityBlock[] => {
  if (gate && Math.abs(along - THEBES_CELL / 2) <= 3) return []
  const height = gate && Math.abs(along - THEBES_CELL / 2) <= 7 ? 13 : 9
  return [0, 1, 2].flatMap((across) => {
    const [x, z] = wall_position(area, edge, segment, along, across)
    const column = sample_world_column(world, x, z)
    if (column.biome === world.ocean?.biome) return []
    const wall = Array.from({ length: height + 3 }, (_, offset) => {
      const y = column.surface_y - 2 + offset
      return Object.freeze([x, y, z, y === column.surface_y + height ? M.tile : M.limestone]) as CityBlock
    })
    const crenel =
      along % 4 === 0 ? [Object.freeze([x, column.surface_y + height + 1, z, M.limestone]) as CityBlock] : []
    return [...wall, ...crenel]
  })
}

const inside_direction = (edge: ThebesWallEdge): readonly [number, number] => {
  if (edge === 'north') return [0, 1]
  if (edge === 'south') return [0, -1]
  if (edge === 'west') return [1, 0]
  return [-1, 0]
}

const stair_position = (
  edge: ThebesWallEdge,
  wall_x: number,
  wall_z: number,
  inward: readonly [number, number],
  distance: number,
  width: number
): readonly [number, number] =>
  edge === 'north' || edge === 'south'
    ? [wall_x + width, wall_z + inward[1] * distance]
    : [wall_x + inward[0] * distance, wall_z + width]

const wall_stairs = (
  world: CompiledWorld,
  area: Readonly<{ min_x: number; max_x: number; min_z: number; max_z: number }>,
  edge: ThebesWallEdge,
  segment: number
): readonly CityBlock[] => {
  const [wall_x, wall_z] = wall_position(area, edge, segment, THEBES_CELL / 2, 2)
  const inward = inside_direction(edge)
  const target_y = sample_world_column(world, wall_x, wall_z).surface_y + 9
  const [start_x, start_z] = stair_position(edge, wall_x, wall_z, inward, 14, 0)
  const start_y = sample_world_column(world, start_x, start_z).surface_y - 1
  return Array.from({ length: 12 }, (_, step) => {
    const progress = step / 11
    const distance = 14 - step
    const step_y = Math.round(start_y + (target_y - start_y) * progress)
    return [-1, 0, 1].flatMap((width) => {
      const [x, z] = stair_position(edge, wall_x, wall_z, inward, distance, width)
      const ground = sample_world_column(world, x, z)
      if (ground.biome === world.ocean?.biome) return []
      return Array.from({ length: Math.max(1, step_y - ground.surface_y + 2) }, (_, offset) =>
        Object.freeze([
          x,
          ground.surface_y - 1 + offset,
          z,
          offset === step_y - ground.surface_y + 1 ? M.tile : M.sandstone,
        ] as const)
      )
    })
  }).flat()
}

export const build_thebes_wall = (
  world: CompiledWorld,
  area: Readonly<{ min_x: number; max_x: number; min_z: number; max_z: number }>,
  edge: ThebesWallEdge,
  segment: number,
  gate: boolean,
  order: number
): PositionedCityStructure | null => {
  const blocks = Array.from({ length: THEBES_CELL }, (_, along) =>
    wall_column(world, area, edge, segment, along, gate)
  ).flat()
  if (!gate && segment % 4 === 2) blocks.push(...wall_stairs(world, area, edge, segment))
  return blocks.length > 0
    ? compile_positioned_city_structure(
        `thebes_${gate ? 'gate' : 'wall'}_${String(order).padStart(4, '0')}`,
        blocks,
        world.materials
      )
    : null
}
