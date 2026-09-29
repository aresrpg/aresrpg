// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  compile_positioned_city_structure,
  type CityBlock,
  type PositionedCityStructure,
} from '../../city_structure.ts'
import type { CompiledWorld } from '../../../world_recipe.ts'
import { sample_world_column } from '../../../world_recipe.ts'
import { THEBES_MATERIALS as M } from '../materials.ts'

export type RoadPoint = readonly [x: number, z: number]

const segment_distance = (point_x: number, point_z: number, [ax, az]: RoadPoint, [bx, bz]: RoadPoint): number => {
  const dx = bx - ax
  const dz = bz - az
  const length_squared = dx * dx + dz * dz
  const amount =
    length_squared === 0 ? 0 : Math.max(0, Math.min(1, ((point_x - ax) * dx + (point_z - az) * dz) / length_squared))
  return Math.hypot(point_x - (ax + dx * amount), point_z - (az + dz * amount))
}

const path_distance = (point_x: number, point_z: number, points: readonly RoadPoint[]): number =>
  points
    .slice(1)
    .reduce(
      (distance, point, index) => Math.min(distance, segment_distance(point_x, point_z, points[index]!, point)),
      Infinity
    )

const road_distance = (x: number, z: number, paths: readonly (readonly RoadPoint[])[]): number =>
  paths.reduce((distance, points) => Math.min(distance, path_distance(x, z, points)), Infinity)

export const build_thebes_paths = (
  world: CompiledWorld,
  paths: readonly (readonly RoadPoint[])[],
  name: string,
  surface_y: (x: number, z: number) => number = (x, z) => sample_world_column(world, x, z).surface_y
): PositionedCityStructure | null => {
  const points = paths.flat()
  const min_x = Math.floor(Math.min(...points.map(([x]) => x))) - 4
  const max_x = Math.ceil(Math.max(...points.map(([x]) => x))) + 4
  const min_z = Math.floor(Math.min(...points.map(([, z]) => z))) - 4
  const max_z = Math.ceil(Math.max(...points.map(([, z]) => z))) + 4
  const width = max_x - min_x + 1
  const blocks = Array.from({ length: width * (max_z - min_z + 1) }, (_, index) => {
    const x = min_x + (index % width)
    const z = min_z + Math.floor(index / width)
    const distance = road_distance(x, z, paths)
    if (distance > 4) return null
    const column = sample_world_column(world, x, z)
    if (column.biome === world.ocean?.biome) return null
    const material = distance > 3 ? M.sandstone : M.limestone
    return [x, surface_y(x, z) - 1, z, material] as CityBlock
  }).filter((block): block is CityBlock => block !== null)
  return blocks.length > 0 ? compile_positioned_city_structure(name, blocks, world.materials) : null
}
