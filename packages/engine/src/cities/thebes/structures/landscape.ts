// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  compile_positioned_city_structure,
  type CityBlock,
  type PositionedCityStructure,
} from '../../city_structure.ts'
import type { CompiledWorld } from '../../../world_recipe.ts'
import type { CompiledCity } from '../../types.ts'
import { THEBES_SKY_CELL, type ThebesLandUse, type ThebesSkyMap } from '../sky_map.ts'

const WOOD = 'temperate_wood'

const cell_coordinates = (index: number, width: number): readonly [number, number] => [
  index % width,
  Math.floor(index / width),
]
const same_use = (
  uses: readonly ThebesLandUse[],
  width: number,
  depth: number,
  x: number,
  z: number,
  use: ThebesLandUse
): boolean => x >= 0 && x < width && z >= 0 && z < depth && uses[z * width + x] === use

const fence_line = (
  start_x: number,
  start_z: number,
  dx: number,
  dz: number,
  surface_y: (x: number, z: number) => number
): readonly CityBlock[] => {
  const heights = Array.from({ length: THEBES_SKY_CELL + 1 }, (_, offset) => {
    const x = start_x + dx * offset
    const z = start_z + dz * offset
    return surface_y(x, z)
  })
  const relief = Math.max(...heights) - Math.min(...heights)
  if (relief > 4 || heights.some((height, index) => Math.abs(height - (heights[index - 1] ?? height)) > 1)) return []
  return heights.flatMap((y, offset) => {
    const x = start_x + dx * offset
    const z = start_z + dz * offset
    return offset % 4 === 0
      ? [
          Object.freeze([x, y, z, WOOD] as const),
          Object.freeze([x, y + 1, z, WOOD] as const),
          Object.freeze([x, y + 2, z, WOOD] as const),
        ]
      : [Object.freeze([x, y + 1, z, WOOD] as const)]
  })
}

const boundary_fences = (
  sky: ThebesSkyMap,
  use: ThebesLandUse,
  x: number,
  z: number,
  origin_x: number,
  origin_z: number,
  surface_y: (x: number, z: number) => number
): readonly CityBlock[] => [
  ...(same_use(sky.uses, sky.width, sky.depth, x, z - 1, use) ? [] : fence_line(origin_x, origin_z, 1, 0, surface_y)),
  ...(same_use(sky.uses, sky.width, sky.depth, x, z + 1, use)
    ? []
    : fence_line(origin_x, origin_z + THEBES_SKY_CELL, 1, 0, surface_y)),
  ...(same_use(sky.uses, sky.width, sky.depth, x - 1, z, use) ? [] : fence_line(origin_x, origin_z, 0, 1, surface_y)),
  ...(same_use(sky.uses, sky.width, sky.depth, x + 1, z, use)
    ? []
    : fence_line(origin_x + THEBES_SKY_CELL, origin_z, 0, 1, surface_y)),
]

export const build_thebes_landscape = (
  world: CompiledWorld,
  city: CompiledCity,
  sky: ThebesSkyMap,
  surface_y: (x: number, z: number) => number
): readonly PositionedCityStructure[] =>
  Object.freeze(
    sky.uses.flatMap((use, index) => {
      if (use !== 'field' && use !== 'garden') return []
      const [x, z] = cell_coordinates(index, sky.width)
      const origin_x = city.area.min_x + x * THEBES_SKY_CELL
      const origin_z = city.area.min_z + z * THEBES_SKY_CELL
      const blocks = boundary_fences(sky, use, x, z, origin_x, origin_z, surface_y)
      return blocks.length > 0
        ? [compile_positioned_city_structure(`thebes_${use}_${x}_${z}`, blocks, world.materials)]
        : []
    })
  )
