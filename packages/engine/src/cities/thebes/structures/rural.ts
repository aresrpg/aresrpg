// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { city_blocks, compile_positioned_city_structure, type PositionedCityStructure } from '../../city_structure.ts'
import { place_tree } from '../../../tree_placement.ts'
import { sample_world_column, type CompiledWorld } from '../../../world_recipe.ts'
import type { CompiledCity } from '../../types.ts'
import { THEBES_SKY_CELL, type ThebesSkyMap, path_distance } from '../sky_map.ts'
import { in_reserved_plot, thebes_layout } from '../plan.ts'
import { THEBES_MATERIALS as M } from '../materials.ts'

const farm = (world: CompiledWorld, x: number, z: number, index: number): PositionedCityStructure => {
  const builder = city_blocks()
  const y = sample_world_column(world, x + 5, z + 5).surface_y
  builder.fill(x + 4, x + 6, y, y + 2, z + 4, z + 6, 'sand')
  builder.fill(x + 5, x + 5, y, y + 2, z + 4, z + 6, 'temperate_wood')
  builder.fill(x - 6, x - 4, y, y + 1, z + 5, z + 6, 'temperate_wood')
  builder.set(x - 5, y + 2, z + 5, M.copper)
  return compile_positioned_city_structure(`thebes_farm_${index}`, builder.finish(), world.materials)
}

export const build_thebes_rural = (
  world: CompiledWorld,
  city: CompiledCity,
  sky: ThebesSkyMap
): readonly PositionedCityStructure[] => {
  const candidates = sky.uses.flatMap((use, index) => {
    if ((use !== 'garden' && use !== 'field') || index % 11 !== 0) return []
    const x = city.area.min_x + ((index % sky.width) + 0.5) * THEBES_SKY_CELL
    const z = city.area.min_z + (Math.floor(index / sky.width) + 0.5) * THEBES_SKY_CELL
    const heights = [-6, 6].flatMap((dx) => [-6, 6].map((dz) => sample_world_column(world, x + dx, z + dz).surface_y))
    return Math.max(...heights) - Math.min(...heights) <= 3 ? [{ use, index, x, z }] : []
  })
  const layout = thebes_layout(city)
  const parks = Array.from({ length: 32 * 32 }, (_, index) => ({
    index,
    x: city.area.anchor_x - 384 + (index % 32) * 24,
    z: city.area.anchor_z - 384 + Math.floor(index / 32) * 24,
  }))
    .filter(({ x, z }) => !in_reserved_plot(layout, x, z))
    .filter(
      ({ x, z, index }) =>
        index % 3 !== 0 &&
        sample_world_column(world, x, z).surface_y > world.recipe.sea_level + 6 &&
        path_distance(x, z, layout.river) > 42 &&
        sky.street_paths.every((path) => path_distance(x, z, path) > 18) &&
        Math.hypot(x - layout.cathedral[0], z - layout.cathedral[1]) > 52 &&
        Math.max(Math.abs(x - sky.castle_center[0]), Math.abs(z - sky.castle_center[1])) > 86
    )
    .sort(
      (a, b) =>
        Math.hypot(a.x - city.area.anchor_x, a.z - city.area.anchor_z) -
        Math.hypot(b.x - city.area.anchor_x, b.z - city.area.anchor_z)
    )
    .slice(0, 100)
  return [
    ...parks.map(({ x, z, index }) =>
      place_tree(
        world,
        `temperate_large_tree_g${(index % 3) + 1}`,
        x,
        sample_world_column(world, x, z).surface_y,
        z,
        1,
        (index % 4) as 0 | 1 | 2 | 3
      )
    ),
    ...layout.trees.map(({ position: [x, z], source, scale, rotation }) =>
      place_tree(
        world,
        source,
        x,
        sample_world_column(world, x, z).surface_y,
        z,
        scale,
        rotation as 0 | 1 | 2 | 3,
        layout.tree_materials
      )
    ),
    ...candidates
      .filter(({ use }) => use === 'field')
      .slice(0, 160)
      .map(({ x, z, index }) => farm(world, x, z, index)),
  ]
}
