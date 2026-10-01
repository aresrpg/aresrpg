// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { FAR_SURFACE_OFFSET } from './far_surface.ts'
import { get_quality_profile } from './quality.ts'
import type { EngineQuality } from './types.ts'
import {
  compile_runtime_world_recipe,
  sample_world_column,
  surface_layer_for_slope,
  terrain_slope,
  type CompiledWorld,
  type WorldRecipe,
} from './world_recipe.ts'

type Request =
  | Readonly<{ type: 'initialize'; world: WorldRecipe }>
  | Readonly<{ type: 'sample'; id: number; quality: EngineQuality; center: readonly [number, number] }>

let world: CompiledWorld | null = null

self.addEventListener('message', ({ data }: MessageEvent<Request>) => {
  if (data.type === 'initialize') {
    world = compile_runtime_world_recipe(data.world, { structures: false })
    return
  }
  if (!world) throw new Error('far worker received work before its world recipe')
  const { horizon_radius, horizon_step } = get_quality_profile(data.quality).chunks
  const side = Math.floor((horizon_radius * 2) / horizon_step) + 1
  const count = side * side
  const heights = new Float32Array(count)
  const material_ids = new Float32Array(count)
  const columns = Array.from({ length: count }, (_, index) => {
    const x = index % side
    const z = Math.floor(index / side)
    return sample_world_column(
      world!,
      data.center[0] - horizon_radius + x * horizon_step,
      data.center[1] - horizon_radius + z * horizon_step
    )
  })
  for (let z = 0; z < side; z += 1) {
    for (let x = 0; x < side; x += 1) {
      const index = z * side + x
      const column = columns[index]!
      heights[index] = column.surface_y - FAR_SURFACE_OFFSET
      const neighbours = [
        x > 0 ? columns[index - 1] : undefined,
        x + 1 < side ? columns[index + 1] : undefined,
        z > 0 ? columns[index - side] : undefined,
        z + 1 < side ? columns[index + side] : undefined,
      ].flatMap((candidate) => (candidate ? [candidate.surface_y] : []))
      const layer = surface_layer_for_slope(terrain_slope(column.surface_y, neighbours, horizon_step))
      const material_id = column[`${layer}_id`]
      material_ids[index] = material_id
    }
  }
  self.postMessage(
    {
      id: data.id,
      quality: data.quality,
      center: data.center,
      heights,
      material_ids,
    },
    {
      transfer: [heights.buffer, material_ids.buffer],
    }
  )
})
