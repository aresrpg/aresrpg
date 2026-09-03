// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { CompiledWorld } from '../../world_recipe.ts'
import { sample_world_column } from '../../world_recipe.ts'
import { hash_position } from '../../world_noise.ts'
import type { CompiledCity } from '../types.ts'
import type { GeneratedCityTerrain } from '../city_terrain.ts'

import { plan_thebes_castle_campus, plan_thebes_center } from './landmarks.ts'
import { THEBES_CELL, thebes_road_bits, type ThebesPlan } from './plan.ts'
import type { ThebesBuildingStyle } from './structures/building.ts'
import { thebes_road_paths, type RoadPoint } from './structures/road.ts'

export const THEBES_SKY_CELL = 16
export type ThebesLandUse = 'water' | 'river' | 'bridge' | 'street' | 'urban' | 'garden' | 'field' | 'wild'
export type ThebesSkyBuilding = Readonly<{
  id: string
  center_x: number
  center_z: number
  entrance: number
  style: ThebesBuildingStyle
  district: 'old_town' | 'residential' | 'artisan' | 'noble' | 'military'
}>
export type ThebesSkyMap = Readonly<{
  width: number
  depth: number
  uses: readonly ThebesLandUse[]
  street_paths: readonly (readonly RoadPoint[])[]
  river_path: readonly RoadPoint[]
  buildings: readonly ThebesSkyBuilding[]
}>

const grid_index = (x: number, z: number, width: number): number => z * width + x
const grid_coordinates = (index: number, width: number): readonly [number, number] => [
  index % width,
  Math.floor(index / width),
]
const inside = (x: number, z: number, width: number, depth: number): boolean =>
  x >= 0 && x < width && z >= 0 && z < depth

const world_point = (city: CompiledCity, x: number, z: number): RoadPoint => [
  city.area.min_x + x * THEBES_SKY_CELL + THEBES_SKY_CELL / 2,
  city.area.min_z + z * THEBES_SKY_CELL + THEBES_SKY_CELL / 2,
]

const sky_coordinates = (city: CompiledCity, [x, z]: RoadPoint): readonly [number, number] => [
  Math.floor((x - city.area.min_x) / THEBES_SKY_CELL),
  Math.floor((z - city.area.min_z) / THEBES_SKY_CELL),
]

const rasterized_path = (
  city: CompiledCity,
  width: number,
  depth: number,
  points: readonly RoadPoint[],
  cell_size = THEBES_SKY_CELL
): readonly number[] => {
  const indexes = new Set<number>()
  points.slice(1).forEach(([bx, bz], segment) => {
    const [ax, az] = points[segment]!
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / (cell_size / 2)))
    for (let step = 0; step <= steps; step += 1) {
      const amount = step / steps
      const x = Math.floor((ax + (bx - ax) * amount - city.area.min_x) / cell_size)
      const z = Math.floor((az + (bz - az) * amount - city.area.min_z) / cell_size)
      if (inside(x, z, width, depth)) indexes.add(grid_index(x, z, width))
    }
  })
  return [...indexes]
}

const TERRAIN_CELL = 8
const ROAD_MAX_RISE = 3
const height_neighbours = (index: number, width: number, depth: number): readonly number[] => {
  const [x, z] = grid_coordinates(index, width)
  return [-1, 0, 1].flatMap((offset_z) =>
    [-1, 0, 1].flatMap((offset_x) => {
      if ((offset_x === 0 && offset_z === 0) || !inside(x + offset_x, z + offset_z, width, depth)) return []
      return [grid_index(x + offset_x, z + offset_z, width)]
    })
  )
}

const graded_road_heights = (
  world: CompiledWorld,
  city: CompiledCity,
  width: number,
  depth: number,
  roads: ReadonlySet<number>
): readonly number[] => {
  const heights = new Int16Array(width * depth).fill(-1)
  roads.forEach((index) => {
    const [x, z] = grid_coordinates(index, width)
    const world_x = city.area.min_x + x * TERRAIN_CELL + TERRAIN_CELL / 2
    const world_z = city.area.min_z + z * TERRAIN_CELL + TERRAIN_CELL / 2
    heights[index] = sample_world_column(world, world_x, world_z).surface_y
  })
  const queue = [...roads]
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor]!
    for (const neighbour of height_neighbours(index, width, depth))
      if (heights[neighbour] >= 0 && heights[neighbour]! > heights[index]! + ROAD_MAX_RISE) {
        heights[neighbour] = heights[index]! + ROAD_MAX_RISE
        queue.push(neighbour)
      }
  }
  return Object.freeze([...heights])
}

export const thebes_city_terrain = (
  world: CompiledWorld,
  city: CompiledCity,
  sky: ThebesSkyMap
): GeneratedCityTerrain => {
  const width = Math.floor((city.area.max_x - city.area.min_x + 1) / TERRAIN_CELL)
  const depth = Math.floor((city.area.max_z - city.area.min_z + 1) / TERRAIN_CELL)
  const road_cells = new Set(
    sky.street_paths
      .flatMap((path) => rasterized_path(city, width, depth, path, TERRAIN_CELL))
      .filter((index) => {
        const [x, z] = grid_coordinates(index, width)
        const world_x = city.area.min_x + x * TERRAIN_CELL + TERRAIN_CELL / 2
        const world_z = city.area.min_z + z * TERRAIN_CELL + TERRAIN_CELL / 2
        return Math.hypot(world_x - city.area.anchor_x, world_z - city.area.anchor_z) > 20
      })
  )
  const river_cells = rasterized_path(city, width, depth, sky.river_path, TERRAIN_CELL)
  return Object.freeze({
    cell_size: TERRAIN_CELL,
    width,
    depth,
    min_x: city.area.min_x,
    min_z: city.area.min_z,
    target_heights: Object.freeze(
      graded_road_heights(world, city, width, depth, road_cells).map((height, index) =>
        river_cells.includes(index) ? world.recipe.sea_level - 3 : height
      )
    ),
    cut_cells: Object.freeze(river_cells),
  })
}

const macro_streets = (world: CompiledWorld, city: CompiledCity, plan: ThebesPlan): readonly (readonly RoadPoint[])[] =>
  plan.cells.flatMap((cell, order) => {
    if (cell.kind !== 'road') return []
    const origin_x = city.area.min_x + cell.x * THEBES_CELL
    const origin_z = city.area.min_z + cell.z * THEBES_CELL
    return thebes_road_paths(world, origin_x, origin_z, cell.openings, world.decoration_seed + order).map((points) =>
      points.map(([x, z]) => [origin_x + x, origin_z + z] as const)
    )
  })

const grid_land = (world: CompiledWorld, city: CompiledCity, width: number, depth: number): readonly boolean[] =>
  Object.freeze(
    Array.from({ length: width * depth }, (_, index) => {
      const [x, z] = grid_coordinates(index, width)
      const [world_x, world_z] = world_point(city, x, z)
      return sample_world_column(world, world_x, world_z).biome !== world.ocean?.biome
    })
  )

const ordered_neighbours = (index: number, width: number, depth: number, seed: number): readonly number[] => {
  const [x, z] = grid_coordinates(index, width)
  return [
    [x - 1, z],
    [x + 1, z],
    [x, z - 1],
    [x, z + 1],
  ]
    .filter(([next_x, next_z]) => inside(next_x!, next_z!, width, depth))
    .map(([next_x, next_z]) => grid_index(next_x!, next_z!, width))
    .sort(
      (left, right) =>
        hash_position(seed, 'thebes-sky-path', left, index, 0x9e3779b9) -
        hash_position(seed, 'thebes-sky-path', right, index, 0x9e3779b9)
    )
}

const shortest_path = (
  allowed: readonly boolean[],
  width: number,
  depth: number,
  start: number,
  target: number,
  seed: number
): readonly number[] => {
  const previous = new Int32Array(width * depth).fill(-1)
  const queue = [start]
  previous[start] = start
  for (let cursor = 0; cursor < queue.length && previous[target] < 0; cursor += 1)
    for (const neighbour of ordered_neighbours(queue[cursor]!, width, depth, seed))
      if (allowed[neighbour] && previous[neighbour] < 0) {
        previous[neighbour] = queue[cursor]!
        queue.push(neighbour)
      }
  if (previous[target] < 0) return []
  const reversed = [target]
  while (reversed.at(-1) !== start) reversed.push(previous[reversed.at(-1)!]!)
  return reversed.reverse()
}

const river_path = (
  world: CompiledWorld,
  city: CompiledCity,
  land: readonly boolean[],
  width: number,
  depth: number,
  streets: ReadonlySet<number>
): readonly RoadPoint[] => {
  const water = land.flatMap((is_land, index) => (is_land ? [] : [index]))
  if (water.length === 0) return Object.freeze([])
  const western_land = land.flatMap((is_land, index) => {
    const [x, z] = grid_coordinates(index, width)
    if (!is_land || x > width / 3) return []
    const [world_x, world_z] = world_point(city, x, z)
    return [{ index, height: sample_world_column(world, world_x, world_z).surface_y }]
  })
  const distance_to_water = (index: number): number => {
    const [x, z] = grid_coordinates(index, width)
    return water.reduce((distance, water_index) => {
      const [water_x, water_z] = grid_coordinates(water_index, width)
      return Math.min(distance, Math.abs(x - water_x) + Math.abs(z - water_z))
    }, Infinity)
  }
  const inland = western_land.filter(({ index }) => distance_to_water(index) >= 12)
  const candidates = inland.length > 0 ? inland : western_land
  const desired_source_height = world.recipe.sea_level + 24
  const source = candidates.reduce((nearest, candidate) =>
    Math.abs(candidate.height - desired_source_height) < Math.abs(nearest.height - desired_source_height)
      ? candidate
      : nearest
  ).index
  const [source_x, source_z] = grid_coordinates(source, width)
  const sink = water.reduce((nearest, index) => {
    const [x, z] = grid_coordinates(index, width)
    const [nearest_x, nearest_z] = grid_coordinates(nearest, width)
    return Math.abs(x - source_x) + Math.abs(z - source_z) <
      Math.abs(nearest_x - source_x) + Math.abs(nearest_z - source_z)
      ? index
      : nearest
  })
  const allowed = land.map((is_land, index) => is_land || index === sink)
  const crossing = [...streets]
    .filter((index) => allowed[index])
    .reduce<number | null>((nearest, index) => {
      if (nearest === null) return index
      const [x, z] = grid_coordinates(index, width)
      const [nearest_x, nearest_z] = grid_coordinates(nearest, width)
      const [sink_x, sink_z] = grid_coordinates(sink, width)
      const score = Math.abs(x - source_x) + Math.abs(z - source_z) + Math.abs(x - sink_x) + Math.abs(z - sink_z)
      const nearest_score =
        Math.abs(nearest_x - source_x) +
        Math.abs(nearest_z - source_z) +
        Math.abs(nearest_x - sink_x) +
        Math.abs(nearest_z - sink_z)
      return score < nearest_score ? index : nearest
    }, null)
  const indexes =
    crossing === null
      ? shortest_path(allowed, width, depth, source, sink, world.decoration_seed)
      : [
          ...shortest_path(allowed, width, depth, source, crossing, world.decoration_seed),
          ...shortest_path(allowed, width, depth, crossing, sink, world.decoration_seed).slice(1),
        ]
  return Object.freeze(
    indexes.map((index) => {
      const [x, z] = grid_coordinates(index, width)
      return world_point(city, x, z)
    })
  )
}

const distances_from = (width: number, depth: number, starts: ReadonlySet<number>): Int16Array => {
  const distances = new Int16Array(width * depth).fill(-1)
  const queue = [...starts]
  queue.forEach((index) => {
    distances[index] = 0
  })
  for (let cursor = 0; cursor < queue.length; cursor += 1)
    for (const neighbour of ordered_neighbours(queue[cursor]!, width, depth, 0))
      if (distances[neighbour] < 0) {
        distances[neighbour] = distances[queue[cursor]!]! + 1
        queue.push(neighbour)
      }
  return distances
}

const entrance_toward = (cell: number, streets: ReadonlySet<number>, width: number): number => {
  const [x, z] = grid_coordinates(cell, width)
  if (streets.has(grid_index(x - 1, z, width))) return thebes_road_bits.WEST
  if (streets.has(grid_index(x + 1, z, width))) return thebes_road_bits.EAST
  if (streets.has(grid_index(x, z - 1, width))) return thebes_road_bits.NORTH
  return thebes_road_bits.SOUTH
}

const district_at = (
  world: CompiledWorld,
  city: CompiledCity,
  x: number,
  z: number,
  castle: readonly [number, number]
): ThebesSkyBuilding['district'] => {
  const [world_x, world_z] = world_point(city, x, z)
  if (Math.hypot(world_x - city.area.anchor_x, world_z - city.area.anchor_z) < 220) return 'old_town'
  if (Math.hypot(x - castle[0], z - castle[1]) < 12) return 'military'
  const choices = ['residential', 'artisan', 'noble'] as const
  return choices[hash_position(world.decoration_seed, 'thebes-sky-district', x, z, 0x85ebca6b) % choices.length]!
}

const style_at = (district: ThebesSkyBuilding['district'], hash: number): ThebesBuildingStyle => {
  const styles: Readonly<Record<ThebesSkyBuilding['district'], readonly ThebesBuildingStyle[]>> = {
    old_town: ['house', 'wood', 'tower', 'house'],
    residential: ['house', 'wood', 'house', 'tower'],
    artisan: ['house', 'wood', 'tower'],
    noble: ['house', 'wood', 'tower'],
    military: ['house', 'tower', 'watchtower'],
  }
  const choices = styles[district]
  return choices[hash % choices.length]!
}

const fixed_land_use = (
  is_land: boolean,
  index: number,
  streets: ReadonlySet<number>,
  river: ReadonlySet<number>
): ThebesLandUse | null => {
  if (!is_land) return 'water'
  if (river.has(index)) return streets.has(index) ? 'bridge' : 'river'
  if (streets.has(index)) return 'street'
  return null
}

const open_land_use = (world: CompiledWorld, index: number, distance: number): ThebesLandUse => {
  if (distance === 1) return 'urban'
  if (distance > 1 && distance <= 4)
    return hash_position(world.decoration_seed, 'thebes-garden', index, distance, 0xc2b2ae35) % 3 === 0
      ? 'garden'
      : 'field'
  return distance <= 8 ? 'field' : 'wild'
}

const land_use_at = (
  world: CompiledWorld,
  is_land: boolean,
  index: number,
  streets: ReadonlySet<number>,
  river: ReadonlySet<number>,
  street_distance: Int16Array
): ThebesLandUse =>
  fixed_land_use(is_land, index, streets, river) ?? open_land_use(world, index, street_distance[index]!)

export const generate_thebes_sky_map = (world: CompiledWorld, city: CompiledCity, plan: ThebesPlan): ThebesSkyMap => {
  const width = Math.floor((city.area.max_x - city.area.min_x + 1) / THEBES_SKY_CELL)
  const depth = Math.floor((city.area.max_z - city.area.min_z + 1) / THEBES_SKY_CELL)
  const land = grid_land(world, city, width, depth)
  const center = plan_thebes_center(city)
  const castle_landmark = plan.landmarks.find(({ style }) => style === 'castle')!
  const castle_complex = plan_thebes_castle_campus(city, castle_landmark)
  const street_paths = Object.freeze([...macro_streets(world, city, plan), ...center.paths, ...castle_complex.paths])
  const streets = new Set(street_paths.flatMap((path) => rasterized_path(city, width, depth, path)))
  const river = river_path(world, city, land, width, depth, streets)
  const river_cells = new Set(rasterized_path(city, width, depth, river))
  const street_distance = distances_from(width, depth, streets)
  const castle_cell = [
    castle_landmark.x * (THEBES_CELL / THEBES_SKY_CELL),
    castle_landmark.z * (THEBES_CELL / THEBES_SKY_CELL),
  ] as const
  const uses = land.map((is_land, index) => land_use_at(world, is_land, index, streets, river_cells, street_distance))
  const buildings = uses.flatMap((use, index): readonly ThebesSkyBuilding[] => {
    if (
      use !== 'urban' ||
      hash_position(world.decoration_seed, 'thebes-building-density', index, 0, 0x27d4eb2e) % 100 >= 88
    )
      return []
    const [x, z] = grid_coordinates(index, width)
    const [center_x, center_z] = world_point(city, x, z)
    const castle_x = city.area.min_x + castle_cell[0] * THEBES_SKY_CELL + THEBES_SKY_CELL / 2
    const castle_z = city.area.min_z + castle_cell[1] * THEBES_SKY_CELL + THEBES_SKY_CELL / 2
    if (
      Math.hypot(center_x - city.area.anchor_x, center_z - city.area.anchor_z) < 105 ||
      Math.hypot(center_x - castle_x, center_z - castle_z) < 105
    )
      return []
    const district = district_at(world, city, x, z, castle_cell)
    const hash = hash_position(world.decoration_seed, `thebes-${district}`, x, z, 0x165667b1)
    return [
      Object.freeze({
        id: `sky:${x}:${z}`,
        center_x,
        center_z,
        entrance: entrance_toward(index, streets, width),
        style: style_at(district, hash),
        district,
      }),
    ]
  })
  return Object.freeze({
    width,
    depth,
    uses: Object.freeze(uses),
    street_paths,
    river_path: river,
    buildings: Object.freeze(buildings),
  })
}
