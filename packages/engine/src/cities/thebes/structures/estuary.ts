// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { city_blocks, compile_positioned_city_structure, type PositionedCityStructure } from '../../city_structure.ts'
import { sample_world_column, type CompiledWorld } from '../../../world_recipe.ts'
import type { ThebesLayout } from '../plan.ts'
import { THEBES_MATERIALS as M } from '../materials.ts'

export const build_thebes_estuary = (
  world: CompiledWorld,
  layout: ThebesLayout
): readonly PositionedCityStructure[] => {
  if (layout.river.length === 0) return []
  const [x, z] = layout.coastal_relic
  const floor = Math.max(world.recipe.sea_level + 1, sample_world_column(world, x, z).surface_y)
  const relic = city_blocks()
  for (let dx = -7; dx <= 7; dx++) {
    for (let dz = -7; dz <= 7; dz++) {
      if (Math.abs(dx) + Math.abs(dz) > 10) continue
      relic.fill(
        x + dx,
        x + dx,
        sample_world_column(world, x + dx, z + dz).surface_y - 1,
        floor,
        z + dz,
        z + dz,
        M.sandstone
      )
    }
  }
  for (const dx of [-5, 5]) {
    relic.fill(x + dx, x + dx + 1, floor + 1, floor + 13, z, z + 1, M.limestone)
    relic.set(x + dx, floor + 14, z, M.copper)
  }
  relic.fill(x - 5, x + 6, floor + 11, floor + 12, z, z + 1, M.tile)
  relic.fill(x - 1, x + 1, floor + 1, floor + 4, z - 2, z, M.copper)
  relic.set(x, floor + 5, z - 1, M.lantern)
  const [cave_x, river_z] = layout.river[6]!
  const cave_z = river_z + 24
  const cave = city_blocks()
  const cave_floor = world.recipe.sea_level + 1
  const sections = Array.from({ length: 25 * 13 }, (_, index) => {
    const depth = Math.floor(index / 13),
      across = (index % 13) - 6
    return { depth, across, top: cave_floor + 3 + Math.floor(Math.sqrt(36 - across * across)) }
  })
  sections.forEach(({ depth, across, top }) =>
    cave.fill(cave_x + across, cave_x + across, cave_floor, top, cave_z + depth, cave_z + depth, M.sandstone)
  )
  sections
    .filter(({ depth, across }) => depth < 24 && Math.abs(across) < 6)
    .forEach(({ depth, across, top }) =>
      cave.fill(cave_x + across, cave_x + across, cave_floor + 1, top - 1, cave_z + depth, cave_z + depth, 'air')
    )
  cave.set(cave_x, cave_floor + 5, cave_z + 20, M.lantern)
  return [
    compile_positioned_city_structure('thebes_coastal_relic', relic.finish(), world.materials),
    compile_positioned_city_structure('thebes_river_grotto', cave.finish(), world.materials),
  ]
}
