// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { sample_world_column, type CompiledWorld } from '../../world_recipe.ts'
import type { CityMapStructure, CityPlacementDraft, CompiledCity } from '../types.ts'
import type { PositionedCityStructure } from '../city_structure.ts'
import { generated_city_surface_height, type GeneratedCityTerrain } from '../city_terrain.ts'

import { plan_thebes_castle_campus, plan_thebes_center, type LandmarkComplex } from './landmarks.ts'
import { plan_thebes_tiles, THEBES_CELL, type ThebesLandmark } from './plan.ts'
import { generate_thebes_sky_map, thebes_city_terrain, THEBES_SKY_CELL, type ThebesSkyMap } from './sky_map.ts'
import {
  build_thebes_building,
  build_thebes_building_at,
  thebes_building_size,
  type ThebesBuildingStyle,
} from './structures/building.ts'
import { build_thebes_landscape } from './structures/landscape.ts'
import { build_thebes_plaza } from './structures/plaza.ts'
import { build_thebes_paths, type RoadPoint } from './structures/road.ts'
import { build_thebes_wall, type ThebesWallEdge } from './structures/wall.ts'
import { build_thebes_waterways } from './structures/waterway.ts'

const draft = (id: string, structure: PositionedCityStructure): CityPlacementDraft =>
  Object.freeze({ id, type: structure.type, x: structure.x, y: structure.y, z: structure.z, rotation: 0 })

const landmark_style = ({ style }: ThebesLandmark): ThebesBuildingStyle => style

const map_structure = (
  id: string,
  type: string,
  min_x: number,
  max_x: number,
  min_z: number,
  max_z: number
): CityMapStructure => Object.freeze({ id, type, min_x, max_x, min_z, max_z })

const map_building_at = (
  center_x: number,
  center_z: number,
  style: ThebesBuildingStyle,
  id: string
): CityMapStructure => {
  const [width, depth] = thebes_building_size(style)
  const origin_x = center_x - Math.floor((width - 1) / 2)
  const origin_z = center_z - Math.floor((depth - 1) / 2)
  return map_structure(id, `thebes_${style}`, origin_x - 1, origin_x + width, origin_z - 1, origin_z + depth)
}

const map_building = (
  city: CompiledCity,
  x: number,
  z: number,
  style: ThebesBuildingStyle,
  id: string
): CityMapStructure =>
  map_building_at(
    city.area.min_x + x * THEBES_CELL + THEBES_CELL / 2,
    city.area.min_z + z * THEBES_CELL + THEBES_CELL / 2,
    style,
    id
  )

const map_paths = (paths: readonly (readonly RoadPoint[])[], id: string): readonly CityMapStructure[] =>
  paths.map((points, index) =>
    map_structure(
      `${id}:path:${index}`,
      'thebes_road',
      Math.floor(Math.min(...points.map(([x]) => x))) - 4,
      Math.ceil(Math.max(...points.map(([x]) => x))) + 4,
      Math.floor(Math.min(...points.map(([, z]) => z))) - 4,
      Math.ceil(Math.max(...points.map(([, z]) => z))) + 4
    )
  )

const wall_map_origin = (city: CompiledCity, edge: ThebesWallEdge, segment: number): readonly [number, number] => {
  if (edge === 'north') return [city.area.min_x + segment * THEBES_CELL, city.area.min_z]
  if (edge === 'south') return [city.area.min_x + segment * THEBES_CELL, city.area.max_z - 2]
  if (edge === 'west') return [city.area.min_x, city.area.min_z + segment * THEBES_CELL]
  return [city.area.max_x - 2, city.area.min_z + segment * THEBES_CELL]
}

const map_wall = (city: CompiledCity, edge: ThebesWallEdge, segment: number, gate: boolean): CityMapStructure => {
  const horizontal = edge === 'north' || edge === 'south'
  const [min_x, min_z] = wall_map_origin(city, edge, segment)
  return map_structure(
    `city:thebes:wall:${edge}:${segment}`,
    gate ? 'thebes_gate' : 'thebes_wall',
    min_x,
    min_x + (horizontal ? THEBES_CELL - 1 : 2),
    min_z,
    min_z + (horizontal ? 2 : THEBES_CELL - 1)
  )
}

const wall_edges = (city: CompiledCity): readonly Readonly<{ edge: ThebesWallEdge; segment: number }>[] => {
  const width = Math.floor((city.area.max_x - city.area.min_x + 1) / THEBES_CELL)
  const depth = Math.floor((city.area.max_z - city.area.min_z + 1) / THEBES_CELL)
  return Object.freeze([
    ...Array.from({ length: width }, (_, segment) => Object.freeze({ edge: 'north' as const, segment })),
    ...Array.from({ length: depth }, (_, segment) => Object.freeze({ edge: 'east' as const, segment })),
    ...Array.from({ length: width }, (_, segment) => Object.freeze({ edge: 'south' as const, segment })),
    ...Array.from({ length: depth }, (_, segment) => Object.freeze({ edge: 'west' as const, segment })),
  ])
}

const wall_drafts = (
  world: CompiledWorld,
  city: CompiledCity,
  gates: ReadonlySet<string>,
  order: number
): readonly CityPlacementDraft[] => {
  return Object.freeze(
    wall_edges(city).flatMap(({ edge, segment }, index) => {
      const structure = build_thebes_wall(
        world,
        city.area,
        edge as ThebesWallEdge,
        segment,
        gates.has(`${edge}:${segment}`),
        order + index
      )
      return structure ? [draft(`city:thebes:wall:${edge}:${segment}`, structure)] : []
    })
  )
}

const sky_building_drafts = (world: CompiledWorld, sky: ThebesSkyMap, order: number): readonly CityPlacementDraft[] =>
  sky.buildings.flatMap((building, index) => {
    const structure = build_thebes_building_at(
      world,
      building.center_x,
      building.center_z,
      building.entrance,
      building.style,
      order + index
    )
    return structure ? [draft(`city:thebes:${building.id}`, structure)] : []
  })

const sky_street_drafts = (
  world: CompiledWorld,
  sky: ThebesSkyMap,
  surface_y: (x: number, z: number) => number
): readonly CityPlacementDraft[] =>
  sky.street_paths.flatMap((path, index) => {
    const structure = build_thebes_paths(world, [path], `thebes_street_${index}`, surface_y)
    return structure ? [draft(`city:thebes:street:${index}`, structure)] : []
  })

const positioned_drafts = (
  structures: readonly PositionedCityStructure[],
  prefix: string
): readonly CityPlacementDraft[] =>
  structures.map((structure, index) => draft(`city:thebes:${prefix}:${index}:${structure.type.name}`, structure))

const mapped_land_use = (use: string): boolean =>
  use === 'field' || use === 'garden' || use === 'river' || use === 'bridge'

const map_sky_cells = (city: CompiledCity, sky: ThebesSkyMap): readonly CityMapStructure[] => {
  const structures: CityMapStructure[] = []
  for (let z = 0; z < sky.depth; z += 1) {
    let x = 0
    while (x < sky.width) {
      const use = sky.uses[z * sky.width + x]!
      if (!mapped_land_use(use)) {
        x += 1
        continue
      }
      let end = x
      while (end + 1 < sky.width && sky.uses[z * sky.width + end + 1] === use) end += 1
      const min_x = city.area.min_x + x * THEBES_SKY_CELL
      const min_z = city.area.min_z + z * THEBES_SKY_CELL
      structures.push(
        map_structure(
          `city:thebes:${use}:${x}:${z}:${end}`,
          `thebes_${use}`,
          min_x,
          city.area.min_x + (end + 1) * THEBES_SKY_CELL - 1,
          min_z,
          min_z + THEBES_SKY_CELL - 1
        )
      )
      x = end + 1
    }
  }
  return Object.freeze(structures)
}

const complex_drafts = (
  world: CompiledWorld,
  complex: LandmarkComplex,
  order: number
): readonly CityPlacementDraft[] => {
  const buildings = complex.buildings.flatMap((building, index) => {
    const structure = build_thebes_building_at(
      world,
      building.center_x,
      building.center_z,
      building.entrance,
      building.style,
      order * 10 + index
    )
    return structure ? [draft(`city:thebes:${building.id}`, structure)] : []
  })
  return Object.freeze(buildings)
}

const map_complex = (complex: LandmarkComplex): readonly CityMapStructure[] => [
  ...complex.buildings.map(({ center_x, center_z, id, style }) =>
    map_building_at(center_x, center_z, style, `city:thebes:${id}`)
  ),
]

export const map_thebes = (world: CompiledWorld, city: CompiledCity): readonly CityMapStructure[] => {
  const plan = plan_thebes_tiles(world, city)
  const sky = generate_thebes_sky_map(world, city, plan)
  const center = plan_thebes_center(city)
  const castle_landmark = plan.landmarks.find(({ style }) => style === 'castle')!
  const castle = plan_thebes_castle_campus(city, castle_landmark)
  const gates = new Set(plan.gates.map(({ edge, segment }) => `${edge}:${segment}`))
  const roads = map_paths(sky.street_paths, 'city:thebes:streets')
  const buildings = sky.buildings.map(({ center_x, center_z, id, style }) =>
    map_building_at(center_x, center_z, style, `city:thebes:${id}`)
  )
  const landmarks = plan.landmarks.map((landmark, order) => {
    const style = landmark_style(landmark)
    return map_building(city, landmark.x, landmark.z, style, `city:thebes:${style}:${order}`)
  })
  const walls = wall_edges(city).map(({ edge, segment }) =>
    map_wall(city, edge, segment, gates.has(`${edge}:${segment}`))
  )
  return Object.freeze([
    map_structure(
      'city:thebes:dungeon-plaza',
      'thebes_dungeon_plaza',
      city.area.anchor_x - 14,
      city.area.anchor_x + 14,
      city.area.anchor_z - 14,
      city.area.anchor_z + 14
    ),
    ...roads,
    ...map_sky_cells(city, sky),
    ...buildings,
    ...map_complex(center),
    ...map_complex(castle),
    ...landmarks,
    ...walls,
  ])
}

export const terrain_thebes = (world: CompiledWorld, city: CompiledCity): GeneratedCityTerrain => {
  const plan = plan_thebes_tiles(world, city)
  return thebes_city_terrain(world, city, generate_thebes_sky_map(world, city, plan))
}

export const plan_thebes = (world: CompiledWorld, city: CompiledCity): readonly CityPlacementDraft[] => {
  const plan = plan_thebes_tiles(world, city)
  const sky = generate_thebes_sky_map(world, city, plan)
  const center = plan_thebes_center(city)
  const castle_landmark = plan.landmarks.find(({ style }) => style === 'castle')!
  const castle = plan_thebes_castle_campus(city, castle_landmark)
  const terrain = thebes_city_terrain(world, city, sky)
  const surface_y = (x: number, z: number): number => {
    const base = sample_world_column(world, x, z).surface_y
    return generated_city_surface_height(terrain, x, z, base)
  }
  const roads = sky_street_drafts(world, sky, surface_y)
  const buildings = sky_building_drafts(world, sky, plan.cells.length)
  const landscapes = positioned_drafts(build_thebes_landscape(world, city, sky, surface_y), 'landscape')
  const waterways = positioned_drafts(build_thebes_waterways(world, city, sky, surface_y), 'waterway')
  const landmarks = plan.landmarks.flatMap((landmark, order) => {
    const style = landmark_style(landmark)
    const structure = build_thebes_building(
      world,
      city.area,
      landmark.x,
      landmark.z,
      landmark.entrance,
      style,
      plan.cells.length + order
    )
    return structure ? [draft(`city:thebes:${style}:${order}`, structure)] : []
  })
  const gates = new Set(plan.gates.map(({ edge, segment }) => `${edge}:${segment}`))
  const plaza = build_thebes_plaza(world, city.area.anchor_x, city.area.anchor_z)
  return Object.freeze([
    draft('city:thebes:dungeon-plaza', plaza),
    ...roads,
    ...landscapes,
    ...waterways,
    ...buildings,
    ...complex_drafts(world, center, plan.cells.length + plan.landmarks.length),
    ...complex_drafts(world, castle, plan.cells.length + plan.landmarks.length + center.buildings.length),
    ...landmarks,
    ...wall_drafts(world, city, gates, plan.cells.length + landmarks.length),
  ])
}
