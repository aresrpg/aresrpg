// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  compile_positioned_city_structure,
  type CityBlock,
  type PositionedCityStructure,
} from '../../city_structure.ts'
import type { CompiledWorld } from '../../../world_recipe.ts'
import { sample_world_column } from '../../../world_recipe.ts'
import { THEBES_CELL, type ThebesPlanCell } from '../plan.ts'
import { THEBES_MATERIALS as M } from '../materials.ts'

const ROAD_ARMS = Object.freeze([
  Object.freeze({ bit: 1, axis: 'x' as const, direction: -1 }),
  Object.freeze({ bit: 2, axis: 'x' as const, direction: 1 }),
  Object.freeze({ bit: 4, axis: 'z' as const, direction: -1 }),
  Object.freeze({ bit: 8, axis: 'z' as const, direction: 1 }),
])
type RoadArm = (typeof ROAD_ARMS)[number]
export type RoadPoint = readonly [x: number, z: number]

const arm_endpoint = (arm: RoadArm): RoadPoint => {
  const center = THEBES_CELL / 2
  const edge = arm.direction < 0 ? 0 : THEBES_CELL - 1
  return arm.axis === 'x' ? [edge, center] : [center, edge]
}

const switchback_point = (arm: RoadArm, end: RoadPoint, progress: number, offset: number): RoadPoint => {
  const center = THEBES_CELL / 2
  const [end_x, end_z] = end
  return arm.axis === 'x'
    ? [center + (end_x - center) * progress, center + (end_z - center) * progress + offset]
    : [center + (end_x - center) * progress + offset, center + (end_z - center) * progress]
}

const curved_points = (arm: RoadArm, seed: number): readonly RoadPoint[] => {
  const center = THEBES_CELL / 2
  const end = arm_endpoint(arm)
  const bend = 3 + (seed % 5)
  const phase = (seed & 1) === 0 ? 1 : -1
  return Object.freeze([
    [center, center],
    switchback_point(arm, end, 0.34, bend * phase),
    switchback_point(arm, end, 0.68, -Math.ceil(bend / 2) * phase),
    end,
  ])
}

const switchback_points = (arm: RoadArm, seed: number): readonly RoadPoint[] => {
  const center = THEBES_CELL / 2
  const end = arm_endpoint(arm)
  const amplitude = 11 + (seed % 5)
  const phase = (seed & 1) === 0 ? 1 : -1
  return Object.freeze([
    [center, center],
    switchback_point(arm, end, 0.2, amplitude * phase),
    switchback_point(arm, end, 0.4, -amplitude * phase),
    switchback_point(arm, end, 0.6, amplitude * phase),
    switchback_point(arm, end, 0.8, -amplitude * phase),
    end,
  ])
}

const arm_points = (world: CompiledWorld, origin_x: number, origin_z: number, arm: RoadArm, seed: number) => {
  const center = THEBES_CELL / 2
  const [end_x, end_z] = arm_endpoint(arm)
  const center_y = sample_world_column(world, origin_x + center, origin_z + center).surface_y
  const end_y = sample_world_column(world, origin_x + end_x, origin_z + end_z).surface_y
  return Math.abs(center_y - end_y) > 8 ? switchback_points(arm, seed) : curved_points(arm, seed)
}

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
    return [x, surface_y(x, z) - 1, z, M.limestone] as CityBlock
  }).filter((block): block is CityBlock => block !== null)
  return blocks.length > 0 ? compile_positioned_city_structure(name, blocks, world.materials) : null
}

export const thebes_road_paths = (
  world: CompiledWorld,
  origin_x: number,
  origin_z: number,
  openings: number,
  seed: number
): readonly (readonly RoadPoint[])[] =>
  ROAD_ARMS.filter(({ bit }) => (openings & bit) !== 0).map((arm, index) =>
    arm_points(world, origin_x, origin_z, arm, seed + index)
  )

export const build_thebes_road = (
  world: CompiledWorld,
  area: Readonly<{ min_x: number; min_z: number }>,
  cell: ThebesPlanCell,
  order: number
): PositionedCityStructure | null => {
  const origin_x = area.min_x + cell.x * THEBES_CELL
  const origin_z = area.min_z + cell.z * THEBES_CELL
  const paths = thebes_road_paths(world, origin_x, origin_z, cell.openings, world.decoration_seed + order).map(
    (points) => points.map(([x, z]) => [origin_x + x, origin_z + z] as const)
  )
  return build_thebes_paths(world, paths, `thebes_road_${String(order).padStart(4, '0')}`)
}
