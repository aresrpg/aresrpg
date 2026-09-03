// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  compile_positioned_city_structure,
  type CityBlock,
  type PositionedCityStructure,
} from '../../city_structure.ts'
import type { CompiledWorld } from '../../../world_recipe.ts'
import type { CompiledCity } from '../../types.ts'
import { THEBES_SKY_CELL, type ThebesSkyMap } from '../sky_map.ts'

const WOOD = 'temperate_wood'

const cell_coordinates = (index: number, width: number): readonly [number, number] => [
  index % width,
  Math.floor(index / width),
]

const bridge_position = (
  center_x: number,
  center_z: number,
  horizontal: boolean,
  along: number,
  across: number
): readonly [number, number] =>
  horizontal ? [center_x + along, center_z + across] : [center_x + across, center_z + along]

const bridge_blocks = (
  center_x: number,
  center_z: number,
  horizontal: boolean,
  surface_y: (x: number, z: number) => number
): readonly CityBlock[] => {
  const heights = Array.from({ length: 15 * 11 }, (_, index) => {
    const [x, z] = bridge_position(center_x, center_z, horizontal, (index % 15) - 7, Math.floor(index / 15) - 5)
    return surface_y(x, z) + 1
  })
  const deck_y = Math.max(...heights)
  const deck = Array.from({ length: 15 * 11 }, (_, index) => {
    const [x, z] = bridge_position(center_x, center_z, horizontal, (index % 15) - 7, Math.floor(index / 15) - 5)
    return Object.freeze([x, deck_y, z, WOOD] as const)
  })
  const rails = [-5, 5].flatMap((across) =>
    Array.from({ length: 15 }, (_, offset) => {
      const [x, z] = bridge_position(center_x, center_z, horizontal, offset - 7, across)
      return offset % 3 === 0
        ? [Object.freeze([x, deck_y + 1, z, WOOD] as const), Object.freeze([x, deck_y + 2, z, WOOD] as const)]
        : [Object.freeze([x, deck_y + 1, z, WOOD] as const)]
    }).flat()
  )
  const supports = [-6, 6].flatMap((along) =>
    [-4, 4].flatMap((across) => {
      const [x, z] = bridge_position(center_x, center_z, horizontal, along, across)
      return Array.from({ length: Math.max(0, deck_y - surface_y(x, z)) }, (_, offset) =>
        Object.freeze([x, deck_y - 1 - offset, z, WOOD] as const)
      )
    })
  )
  return [...deck, ...rails, ...supports]
}

const street_use = (sky: ThebesSkyMap, x: number, z: number): boolean => {
  const use = x >= 0 && x < sky.width && z >= 0 && z < sky.depth ? sky.uses[z * sky.width + x] : null
  return use === 'street' || use === 'bridge'
}

const horizontal_bridge = (sky: ThebesSkyMap, x: number, z: number): boolean =>
  Number(street_use(sky, x - 1, z)) + Number(street_use(sky, x + 1, z)) >=
  Number(street_use(sky, x, z - 1)) + Number(street_use(sky, x, z + 1))

export const build_thebes_waterways = (
  world: CompiledWorld,
  city: CompiledCity,
  sky: ThebesSkyMap,
  surface_y: (x: number, z: number) => number
): readonly PositionedCityStructure[] =>
  Object.freeze(
    sky.uses.flatMap((use, index) => {
      if (use !== 'bridge') return []
      const [x, z] = cell_coordinates(index, sky.width)
      const center_x = city.area.min_x + x * THEBES_SKY_CELL + THEBES_SKY_CELL / 2
      const center_z = city.area.min_z + z * THEBES_SKY_CELL + THEBES_SKY_CELL / 2
      return [
        compile_positioned_city_structure(
          `thebes_bridge_${x}_${z}`,
          bridge_blocks(center_x, center_z, horizontal_bridge(sky, x, z), surface_y),
          world.materials
        ),
      ]
    })
  )
