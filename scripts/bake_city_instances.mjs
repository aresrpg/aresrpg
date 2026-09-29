// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { compile_positioned_city_structure } from '../packages/engine/src/cities/city_structure.ts'
import { for_each_structure_voxel, placement_bounds } from '../packages/engine/src/structure_placement.ts'
import { sample_world_column } from '../packages/engine/src/world_recipe.ts'

import { bake_schematic } from './bake_schematic.mjs'

/** Large solid landmarks reuse the native integer-volume transform, never sparse point scaling. */
export const bake_city_instances = (world, assets, anchor, instances) =>
  instances.flatMap((instance) => {
    const { asset, position, rotation, scale, buried } = instance
    if (
      ![Number.isInteger(scale), scale >= 1, scale <= 5, Number.isFinite(buried), buried >= 0, buried <= 1].every(
        Boolean
      )
    )
      throw new TypeError('Invalid landmark scale or burial')
    const template = bake_schematic(
      {
        ...assets,
        instance: {
          kind: 'building',
          parts: [{ asset, position: [0, 0, 0], rotation: 0, mirror: instance.mirror ?? false }],
        },
      },
      'instance'
    )
    if (template.details.length + template.plants.length + template.vines.length + template.fires.length)
      throw new TypeError('Scaled landmarks require solid voxel templates')
    const compiled = compile_positioned_city_structure(asset, template.blocks, world.materials)
    const type = { ...compiled.type, anchor: [-compiled.x, -compiled.y, -compiled.z] }
    const x = anchor[0] + position[0],
      z = anchor[1] + position[2]
    const y = sample_world_column(world, x, z).surface_y + position[1] - Math.round(type.size[1] * scale * buried)
    const origin = [x, y, z],
      bounds = placement_bounds(type, origin, rotation, scale),
      blocks = []
    for_each_structure_voxel(
      {
        id: asset,
        pack: 'authored',
        type,
        origin,
        rotation,
        scale,
        bounds,
        overlap_bounds: bounds,
        portal_clearance: true,
      },
      (px, py, pz, id) => blocks.push([px, py, pz, world.materials.entries[id].name])
    )
    return blocks
  })
