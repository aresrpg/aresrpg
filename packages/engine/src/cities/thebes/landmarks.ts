// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { CompiledCity } from '../types.ts'

import { THEBES_CELL, thebes_road_bits, type ThebesLandmark } from './plan.ts'
import type { ThebesBuildingStyle } from './structures/building.ts'
import type { RoadPoint } from './structures/road.ts'

export type LandmarkBuilding = Readonly<{
  id: string
  center_x: number
  center_z: number
  entrance: number
  style: ThebesBuildingStyle
}>
export type LandmarkComplex = Readonly<{
  buildings: readonly LandmarkBuilding[]
  paths: readonly (readonly RoadPoint[])[]
}>

const building = (
  id: string,
  center_x: number,
  center_z: number,
  entrance: number,
  style: ThebesBuildingStyle
): LandmarkBuilding => Object.freeze({ id, center_x, center_z, entrance, style })

export const plan_thebes_center = (city: CompiledCity): LandmarkComplex => {
  const x = city.area.anchor_x
  const z = city.area.anchor_z
  const row_offsets = [-45, -27, -9, 9, 27, 45]
  const side_offsets = [-27, -9, 9, 27]
  const row_styles = ['house', 'wood', 'tower', 'house', 'wood', 'house'] as const
  const north = row_offsets.map((offset, index) =>
    building(`center:north:${index}`, x + offset, z - 28, thebes_road_bits.SOUTH, row_styles[index]!)
  )
  const south = row_offsets.map((offset, index) =>
    building(`center:south:${index}`, x + offset, z + 28, thebes_road_bits.NORTH, row_styles.at(-index - 1)!)
  )
  const west = side_offsets.map((offset, index) =>
    building(`center:west:${index}`, x - 45, z + offset, thebes_road_bits.EAST, index % 2 ? 'wood' : 'house')
  )
  const east = side_offsets.map((offset, index) =>
    building(`center:east:${index}`, x + 45, z + offset, thebes_road_bits.WEST, index % 2 ? 'house' : 'tower')
  )
  const civic = [
    building('center:town-hall', x, z + 68, thebes_road_bits.NORTH, 'town_hall'),
    building('center:temple', x, z - 64, thebes_road_bits.SOUTH, 'temple'),
    building('center:market-west', x - 68, z, thebes_road_bits.EAST, 'market'),
    building('center:market-east', x + 68, z, thebes_road_bits.WEST, 'market'),
  ]
  return Object.freeze({
    buildings: Object.freeze([...north, ...south, ...west, ...east, ...civic]),
    paths: Object.freeze([
      Object.freeze([
        [x - 58, z - 17],
        [x + 58, z - 17],
      ] as const),
      Object.freeze([
        [x - 58, z + 17],
        [x + 58, z + 17],
      ] as const),
      Object.freeze([
        [x - 33, z - 44],
        [x - 33, z + 44],
      ] as const),
      Object.freeze([
        [x + 33, z - 44],
        [x + 33, z + 44],
      ] as const),
      Object.freeze([
        [x, z - 72],
        [x, z + 76],
      ] as const),
      Object.freeze([
        [x - 76, z],
        [x + 76, z],
      ] as const),
    ]),
  })
}

export const plan_thebes_castle_campus = (city: CompiledCity, castle: ThebesLandmark): LandmarkComplex => {
  const x = city.area.min_x + castle.x * THEBES_CELL + THEBES_CELL / 2
  const z = city.area.min_z + castle.z * THEBES_CELL + THEBES_CELL / 2
  const buildings = [
    building('castle:tower-nw', x - 42, z - 42, thebes_road_bits.SOUTH, 'watchtower'),
    building('castle:tower-ne', x + 42, z - 42, thebes_road_bits.SOUTH, 'watchtower'),
    building('castle:tower-sw', x - 42, z + 42, thebes_road_bits.NORTH, 'watchtower'),
    building('castle:tower-se', x + 42, z + 42, thebes_road_bits.NORTH, 'watchtower'),
    building('castle:barracks-north', x, z - 48, thebes_road_bits.SOUTH, 'barracks'),
    building('castle:barracks-south', x, z + 48, thebes_road_bits.NORTH, 'barracks'),
    building('castle:barracks-west', x - 52, z, thebes_road_bits.EAST, 'barracks'),
    building('castle:barracks-east', x + 52, z, thebes_road_bits.WEST, 'barracks'),
  ]
  return Object.freeze({
    buildings: Object.freeze(buildings),
    paths: Object.freeze([
      Object.freeze([
        [x - 36, z - 36],
        [x + 36, z - 36],
        [x + 36, z + 36],
        [x - 36, z + 36],
        [x - 36, z - 36],
      ] as const),
      Object.freeze([
        [x, z - 64],
        [x, z + 64],
      ] as const),
      Object.freeze([
        [x - 64, z],
        [x + 64, z],
      ] as const),
    ]),
  })
}
