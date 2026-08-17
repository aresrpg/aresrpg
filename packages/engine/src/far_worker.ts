// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { get_quality_profile } from './quality.ts'
import { material_pattern } from './material_presets.ts'
import type { EngineQuality } from './types.ts'
import { WATER_SURFACE_LAYOUT } from './water_surface_layout.ts'
import { compile_world_recipe, sample_world_column, type CompiledWorld, type WorldRecipe } from './world_recipe.ts'

type Request =
  | Readonly<{ type: 'initialize'; world: WorldRecipe }>
  | Readonly<{ type: 'sample'; id: number; quality: EngineQuality; center: readonly [number, number] }>
  | Readonly<{ type: 'water'; id: number; center: readonly [number, number] }>

let world: CompiledWorld | null = null

self.addEventListener('message', ({ data }: MessageEvent<Request>) => {
  if (data.type === 'initialize') {
    world = compile_world_recipe(data.world)
    return
  }
  if (!world) throw new Error('far worker received work before its world recipe')
  if (data.type === 'water') {
    // The water shader's analytic bed: per-vertex ground height + bed color under the sea plane —
    // depth optics from DATA, no framebuffer depth grab (the legacy pain this architecture retires).
    const count = WATER_SURFACE_LAYOUT.positions.length / 3
    const bed_heights = new Float32Array(count)
    const bed_material_ids = new Float32Array(count)
    for (let index = 0; index < count; index += 1) {
      const world_x = data.center[0] + WATER_SURFACE_LAYOUT.positions[index * 3]!
      const world_z = data.center[1] + WATER_SURFACE_LAYOUT.positions[index * 3 + 2]!
      const column = sample_world_column(world, world_x, world_z)
      bed_heights[index] = column.surface_y
      bed_material_ids[index] = column.surface_id
    }
    self.postMessage(
      { type: 'water', id: data.id, center: data.center, bed_heights, bed_material_ids },
      { transfer: [bed_heights.buffer, bed_material_ids.buffer] }
    )
    return
  }
  const { horizon_radius, horizon_step } = get_quality_profile(data.quality).chunks
  const side = Math.floor((horizon_radius * 2) / horizon_step) + 1
  const count = side * side
  const heights = new Float32Array(count)
  const base_colors = new Float32Array(count * 3)
  const paired_colors = new Float32Array(count * 3)
  const roughness = new Float32Array(count)
  const climate_tint = new Float32Array(count)
  for (let z = 0; z < side; z += 1) {
    for (let x = 0; x < side; x += 1) {
      const index = z * side + x
      const world_x = data.center[0] - horizon_radius + x * horizon_step
      const world_z = data.center[1] - horizon_radius + z * horizon_step
      const column = sample_world_column(world, world_x, world_z)
      heights[index] = column.surface_y - 0.5
      const surface = world.materials.entries[column.surface_id]!
      const modulation = 1 + material_pattern(surface.preset, world_x, world_z, 0)
      base_colors.set(
        surface.color.map((channel) => channel * modulation),
        index * 3
      )
      paired_colors.set(surface.paired_color, index * 3)
      roughness[index] = surface.roughness
      climate_tint[index] = surface.climate_tint ? 1 : 0
    }
  }
  self.postMessage(
    {
      id: data.id,
      quality: data.quality,
      center: data.center,
      heights,
      base_colors,
      paired_colors,
      roughness,
      climate_tint,
    },
    { transfer: [heights.buffer, base_colors.buffer, paired_colors.buffer, roughness.buffer, climate_tint.buffer] }
  )
})
