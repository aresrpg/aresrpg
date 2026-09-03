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

export const build_thebes_plaza = (
  world: CompiledWorld,
  anchor_x: number,
  anchor_z: number
): PositionedCityStructure => {
  const radius = 14
  const blocks = Array.from({ length: (radius * 2 + 1) ** 2 }, (_, index) => {
    const x = anchor_x - radius + (index % (radius * 2 + 1))
    const z = anchor_z - radius + Math.floor(index / (radius * 2 + 1))
    const column = sample_world_column(world, x, z)
    const border = Math.abs(x - anchor_x) === radius || Math.abs(z - anchor_z) === radius
    return Object.freeze([x, column.surface_y - 1, z, border ? M.tile : M.limestone]) as CityBlock
  })
  return compile_positioned_city_structure('thebes_dungeon_plaza', blocks, world.materials)
}
