// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { get_quality_profile } from './quality.ts'
import type { EngineQuality } from './types.ts'
import { sample_world_column, type CompiledWorld } from './world_recipe.ts'

export const FAR_SURFACE_OFFSET = 0.5

/** Height on the actual two-triangle horizon grid, outside its inner seam.
 * Grid alignment includes the profile radius; sampling raw terrain can float distant scenery. */
export const sample_far_height = (world: CompiledWorld, quality: EngineQuality, x: number, z: number): number => {
  const { horizon_step: step, horizon_radius: radius } = get_quality_profile(quality).chunks
  const x0 = Math.floor((x + radius) / step) * step - radius
  const z0 = Math.floor((z + radius) / step) * step - radius
  const u = (x - x0) / step,
    v = (z - z0) / step
  const at = (dx: number, dz: number) =>
    sample_world_column(world, x0 + dx * step, z0 + dz * step).surface_y - FAR_SURFACE_OFFSET
  return u + v <= 1
    ? at(0, 0) * (1 - u - v) + at(1, 0) * u + at(0, 1) * v
    : at(1, 1) * (u + v - 1) + at(0, 1) * (1 - u) + at(1, 0) * (1 - v)
}
