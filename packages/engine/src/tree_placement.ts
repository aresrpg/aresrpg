// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  city_blocks,
  compile_positioned_city_structure,
  type PositionedCityStructure,
} from './cities/city_structure.ts'
import { compile_type } from './structures.ts'
import { for_each_structure_voxel, placement_bounds } from './structure_placement.ts'
import { sample_world_column, type CompiledWorld } from './world_recipe.ts'

/** Authored scenes place catalogue trees through the native voxel transform and shared terrain anchoring. */
export const place_tree = (
  world: CompiledWorld,
  source: string,
  x: number,
  y: number,
  z: number,
  scale: number,
  rotation: 0 | 1 | 2 | 3,
  palette: Readonly<Record<string, string>> = {}
): PositionedCityStructure => {
  const type = compile_type(source, {
    ...world.materials,
    id_for: (name) => world.materials.id_for(palette[name] ?? name),
  })
  const placement = (height: number) => {
    const origin = [x, height, z] as const
    const bounds = placement_bounds(type, origin, rotation, scale)
    return {
      id: source,
      pack: 'fixed',
      type,
      origin,
      rotation,
      scale,
      bounds,
      overlap_bounds: bounds,
      portal_clearance: true,
    }
  }
  const initial = placement(y)
  let grounded_y = y
  for_each_structure_voxel(
    initial,
    (px, py, pz, material) => {
      if (material !== 0 && world.materials.entries[material]!.preset !== 'foliage')
        grounded_y = Math.min(grounded_y, sample_world_column(world, px, pz).surface_y - (py - y))
    },
    { min: initial.bounds.min_y, max: initial.bounds.min_y }
  )
  const blocks = city_blocks()
  for_each_structure_voxel(placement(grounded_y), (px, py, pz, material) =>
    blocks.set(px, py, pz, material === 0 ? 'air' : world.materials.entries[material]!.name)
  )
  return compile_positioned_city_structure(`tree_${source}_${x}_${z}`, blocks.finish(), world.materials)
}
