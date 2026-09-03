// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { ChunkRenderData, RenderChunkRequest, Vec3 } from './types.ts'
import { CHUNK_EDGE, pack_voxel_occupancy, voxel_index } from './voxel_data.ts'
import { apply_voxel_operation } from './voxel_operation.ts'
import { for_each_structure_voxel, structure_placements, type StructurePlacement } from './structure_placement.ts'
import {
  sample_world_column,
  terrain_material_id,
  terrain_slope,
  WORLD_HEIGHT,
  type CompiledWorld,
} from './world_recipe.ts'

const AIR = 0

export const chunk_origin = ({ x, y, z }: RenderChunkRequest['coordinate']): Vec3 =>
  [x * CHUNK_EDGE, y * CHUNK_EDGE, z * CHUNK_EDGE] as const

export const surface_chunk_layers = (
  world: CompiledWorld,
  chunk_x: number,
  chunk_z: number,
  planned_structures?: readonly StructurePlacement[]
): readonly number[] => {
  const surfaces = Array.from({ length: (CHUNK_EDGE + 2) ** 2 }, (_, index) => {
    const x = (index % (CHUNK_EDGE + 2)) - 1
    const z = Math.floor(index / (CHUNK_EDGE + 2)) - 1
    return sample_world_column(world, chunk_x * CHUNK_EDGE + x, chunk_z * CHUNK_EDGE + z).surface_y
  })
  const area = {
    min_x: chunk_x * CHUNK_EDGE,
    max_x: (chunk_x + 1) * CHUNK_EDGE - 1,
    min_z: chunk_z * CHUNK_EDGE,
    max_z: (chunk_z + 1) * CHUNK_EDGE - 1,
  }
  const structures = (planned_structures ?? structure_placements(world, area)).filter(
    ({ bounds }) =>
      bounds.max_x >= area.min_x &&
      bounds.min_x <= area.max_x &&
      bounds.max_z >= area.min_z &&
      bounds.min_z <= area.max_z
  )
  const first_y = Math.min(...surfaces.map((height) => height - 1), ...structures.map(({ bounds }) => bounds.min_y))
  const last_y = Math.max(...surfaces.map((height) => height - 1), ...structures.map(({ bounds }) => bounds.max_y))
  const first = Math.max(0, Math.floor(first_y / CHUNK_EDGE))
  const last = Math.min(WORLD_HEIGHT / CHUNK_EDGE - 1, Math.floor(last_y / CHUNK_EDGE))
  return Object.freeze(Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => first + index))
}

export const generate_chunk = (
  world: CompiledWorld,
  request: RenderChunkRequest,
  planned_structures?: readonly StructurePlacement[]
): ChunkRenderData => {
  const origin = chunk_origin(request.coordinate)
  const overlay_edge = CHUNK_EDGE + 2
  // -1 means no structure operation. Zero is an explicit air operation used to carve terrain;
  // positive values add or replace material. One tri-state owns render occupancy.
  const structure_materials = new Int16Array(overlay_edge ** 3).fill(-1)
  const overlay_index = (x: number, y: number, z: number): number =>
    (y + 1) * overlay_edge * overlay_edge + (z + 1) * overlay_edge + x + 1
  const area = {
    min_x: origin[0] - 1,
    max_x: origin[0] + CHUNK_EDGE,
    min_z: origin[2] - 1,
    max_z: origin[2] + CHUNK_EDGE,
  }
  ;(planned_structures ?? structure_placements(world, area)).forEach((placement) =>
    for_each_structure_voxel(
      placement,
      (world_x, world_y, world_z, material_id) => {
        const x = world_x - origin[0]
        const y = world_y - origin[1]
        const z = world_z - origin[2]
        if (x < -1 || x > CHUNK_EDGE || y < -1 || y > CHUNK_EDGE || z < -1 || z > CHUNK_EDGE) return
        structure_materials[overlay_index(x, y, z)] = material_id
      },
      { min: origin[1] - 1, max: origin[1] + CHUNK_EDGE },
      area
    )
  )
  // Occupancy asks for a one-block halo; slope classification needs one more neighbour beyond it.
  const column_edge = CHUNK_EDGE + 4
  const columns = Array.from({ length: column_edge * column_edge }, (_, index) => {
    const x = (index % column_edge) - 2
    const z = Math.floor(index / column_edge) - 2
    return sample_world_column(world, origin[0] + x, origin[2] + z)
  })
  const slopes = new Float32Array(columns.length)
  for (let z = 1; z < column_edge - 1; z += 1)
    for (let x = 1; x < column_edge - 1; x += 1) {
      const index = z * column_edge + x
      slopes[index] = terrain_slope(columns[index]!.surface_y, [
        columns[index - 1]!.surface_y,
        columns[index + 1]!.surface_y,
        columns[index - column_edge]!.surface_y,
        columns[index + column_edge]!.surface_y,
      ])
    }
  const sample = (x: number, y: number, z: number): number => {
    const structure = structure_materials[overlay_index(x, y, z)]!
    const index = (z + 2) * column_edge + x + 2
    const column = columns[index]!
    const world_y = origin[1] + y
    const terrain =
      world_y >= column.surface_y ? AIR : terrain_material_id(column, column.surface_y - world_y - 1, slopes[index]!)
    return apply_voxel_operation(structure >= AIR ? structure : undefined, terrain)
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
