// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { ChunkRenderData, RenderChunkRequest, Vec3 } from './types.ts'
import { CHUNK_EDGE, pack_voxel_occupancy, voxel_index } from './voxel_data.ts'
import { sample_world_column, type CompiledWorld } from './world_recipe.ts'

const WORLD_BASE_Y = -16
const AIR = 0

export const chunk_origin = ({ x, y, z }: RenderChunkRequest['coordinate']): Vec3 =>
  [x * CHUNK_EDGE, WORLD_BASE_Y + y * CHUNK_EDGE, z * CHUNK_EDGE] as const

export const generate_chunk = (world: CompiledWorld, request: RenderChunkRequest): ChunkRenderData => {
  const origin = chunk_origin(request.coordinate)
  const column_edge = CHUNK_EDGE + 2
  const columns = Array.from({ length: column_edge * column_edge }, (_, index) => {
    const x = (index % column_edge) - 1
    const z = Math.floor(index / column_edge) - 1
    return sample_world_column(world, origin[0] + x, origin[2] + z)
  })
  const sample = (x: number, y: number, z: number): number => {
    const column = columns[(z + 1) * column_edge + x + 1]
    const world_y = origin[1] + y
    if (world_y >= column.surface_y) return AIR
    if (world_y < column.surface_y - 4) return column.filler_id
    if (world_y < column.surface_y - 1) return column.subsurface_id
    return column.surface_id
  }
  const material_ids = new Uint16Array(CHUNK_EDGE ** 3)
  for (let y = 0; y < CHUNK_EDGE; y += 1)
    for (let z = 0; z < CHUNK_EDGE; z += 1)
      for (let x = 0; x < CHUNK_EDGE; x += 1) material_ids[voxel_index(x, y, z)] = sample(x, y, z)

  return {
    ...request,
    origin,
    resolution: CHUNK_EDGE,
    cell_size: 1,
    material_ids,
    ...pack_voxel_occupancy((x, y, z) => sample(x, y, z) !== AIR),
  }
}
