// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  compile_positioned_city_structure,
  type CityBlock,
  type PositionedCityStructure,
} from '../../city_structure.ts'
import type { CompiledWorld } from '../../../world_recipe.ts'
import type { CompiledCity } from '../../types.ts'
import { THEBES_MATERIALS as M } from '../materials.ts'
import { THEBES_SKY_CELL, type ThebesSkyMap } from '../sky_map.ts'

export const build_thebes_landscape = (
  world: CompiledWorld,
  city: CompiledCity,
  sky: ThebesSkyMap,
  surface_y: (x: number, z: number) => number
): readonly PositionedCityStructure[] =>
  Object.freeze(
    sky.uses.flatMap((use, index) => {
      if (!['field', 'garden', 'street', 'urban'].includes(use)) return []
      const x = index % sky.width,
        z = Math.floor(index / sky.width)
      const origin_x = city.area.min_x + x * THEBES_SKY_CELL
      const origin_z = city.area.min_z + z * THEBES_SKY_CELL
      const cover = Array.from({ length: THEBES_SKY_CELL * THEBES_SKY_CELL }, (_, offset) => {
        const px = origin_x + (offset % THEBES_SKY_CELL)
        const pz = origin_z + Math.floor(offset / THEBES_SKY_CELL)
        const material =
          use === 'field'
            ? px % 3 === 0
              ? 'dirt'
              : 'rich_soil'
            : ['garden', 'grove'].includes(use)
              ? 'grass'
              : M.sandstone
        return [px, surface_y(px, pz) - 1, pz, material] as CityBlock
      })
      const blocks = cover
      return [compile_positioned_city_structure(`thebes_${use}_${x}_${z}`, blocks, world.materials)]
    })
  )
