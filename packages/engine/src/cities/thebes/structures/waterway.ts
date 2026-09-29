// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { city_blocks, compile_positioned_city_structure } from '../../city_structure.ts'
import { sample_world_column, type CompiledWorld } from '../../../world_recipe.ts'
import type { ThebesLayout } from '../plan.ts'
import { THEBES_MATERIALS as M } from '../materials.ts'

/** Each stone arch follows the route's walkable deck while leaving the carved river underneath. */
export const build_thebes_waterways = (world: CompiledWorld, layout: ThebesLayout) =>
  layout.bridges.map((bridge) => {
    const b = city_blocks(),
      [x, y, z] = bridge.start,
      { end } = bridge
    const length = end[2] - z,
      radius = Math.floor(bridge.width / 2)
    for (let along = 0; along <= length; along++) {
      const deck = Math.round(y + ((end[1] - y) * along) / length) - 1
      const arch_phase = (along % 32) / 32
      const thickness = 3 + Math.round(12 * (1 - Math.sin(Math.PI * arch_phase)))
      b.fill(x - radius, x + radius, deck - thickness, deck, z + along, z + along, M.limestone)
      b.fill(x - radius + 1, x + radius - 1, deck + 1, deck + 6, z + along, z + along, 'air')
      for (const side of [-1, 1]) b.set(x + side * radius, deck + 1, z + along, M.sandstone)
      if (along % 32 === 0)
        b.fill(
          x - radius,
          x + radius,
          sample_world_column(world, x, z + along).surface_y - 1,
          deck - 2,
          z + along - 1,
          z + along + 1,
          M.sandstone
        )
    }
    return compile_positioned_city_structure(`thebes_${bridge.id}`, b.finish(), world.materials)
  })
