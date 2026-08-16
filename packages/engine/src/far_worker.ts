// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { get_quality_profile } from './quality.ts'
import type { EngineQuality } from './types.ts'
import { compile_world_recipe, sample_world_column, type CompiledWorld, type WorldRecipe } from './world_recipe.ts'

type Request =
  | Readonly<{ type: 'initialize'; world: WorldRecipe }>
  | Readonly<{ type: 'sample'; id: number; quality: EngineQuality; center: readonly [number, number] }>
  | Readonly<{ type: 'water'; id: number; center: readonly [number, number]; span: number; step: number }>

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
    const side = Math.floor(data.span / data.step) + 1
    const bed_heights = new Float32Array(side * side)
    const bed_material_ids = new Float32Array(side * side)
    for (let z = 0; z < side; z += 1) {
      for (let x = 0; x < side; x += 1) {
        const index = z * side + x
        const world_x = data.center[0] - data.span / 2 + x * data.step
        const world_z = data.center[1] - data.span / 2 + z * data.step
        const column = sample_world_column(world, world_x, world_z)
        bed_heights[index] = column.surface_y
        bed_material_ids[index] = column.surface_id
      }
    }
    self.postMessage(
      { type: 'water', id: data.id, center: data.center, side, bed_heights, bed_material_ids },
      { transfer: [bed_heights.buffer, bed_material_ids.buffer] }
    )
    return
  }
  const { horizon_radius, horizon_step } = get_quality_profile(data.quality).chunks
  const side = Math.floor((horizon_radius * 2) / horizon_step) + 1
  const count = side * side
  const heights = new Float32Array(count)
  const normals = new Float32Array(count * 3)
  const material_ids = new Float32Array(count)
  for (let z = 0; z < side; z += 1) {
    for (let x = 0; x < side; x += 1) {
      const index = z * side + x
      const world_x = data.center[0] - horizon_radius + x * horizon_step
      const world_z = data.center[1] - horizon_radius + z * horizon_step
      const column = sample_world_column(world, world_x, world_z)
      heights[index] = column.surface_y - 0.5
      material_ids[index] = column.surface_id
    }
  }
  for (let z = 0; z < side; z += 1) {
    for (let x = 0; x < side; x += 1) {
      const index = z * side + x
      const left = heights[z * side + Math.max(0, x - 1)]
      const right = heights[z * side + Math.min(side - 1, x + 1)]
      const back = heights[Math.max(0, z - 1) * side + x]
      const front = heights[Math.min(side - 1, z + 1) * side + x]
      const nx = left - right
      const ny = horizon_step * 2
      const nz = back - front
      const length = Math.hypot(nx, ny, nz)
      normals.set([nx / length, ny / length, nz / length], index * 3)
    }
  }
  self.postMessage(
    { id: data.id, quality: data.quality, center: data.center, heights, normals, material_ids },
    { transfer: [heights.buffer, normals.buffer, material_ids.buffer] }
  )
})
