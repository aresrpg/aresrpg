// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { greedy_mesh } from './greedy_mesher.ts'
import { chunk_scatter } from './scatter.ts'
import { structure_placements, type StructurePlacement } from './structure_placement.ts'
import { generate_chunk } from './terrain_generator.ts'
import type { RenderChunkRequest, RenderedChunk } from './types.ts'
import { CHUNK_EDGE } from './voxel_data.ts'
import { compile_world_recipe, type CompiledWorld, type WorldRecipe } from './world_recipe.ts'

type WorkerRequest =
  | Readonly<{ type: 'initialize'; world: WorldRecipe }>
  | Readonly<{ type: 'mesh'; id: number; chunk: RenderChunkRequest }>

let world: CompiledWorld | null = null
const structure_cache = new Map<string, readonly StructurePlacement[]>()

self.addEventListener('message', ({ data }: MessageEvent<WorkerRequest>) => {
  if (data.type === 'initialize') {
    world = compile_world_recipe(data.world)
    structure_cache.clear()
    return
  }
  if (!world) throw new Error('mesh worker received work before its world recipe')
  const horizontal_key = `${data.chunk.coordinate.x}:${data.chunk.coordinate.z}`
  let structures = structure_cache.get(horizontal_key)
  if (!structures) {
    if (structure_cache.size > 128) structure_cache.clear()
    structures = structure_placements(world, {
      min_x: data.chunk.coordinate.x * CHUNK_EDGE - 1,
      max_x: (data.chunk.coordinate.x + 1) * CHUNK_EDGE,
      min_z: data.chunk.coordinate.z * CHUNK_EDGE - 1,
      max_z: (data.chunk.coordinate.z + 1) * CHUNK_EDGE,
    })
    structure_cache.set(horizontal_key, structures)
  }
  const generated = generate_chunk(world, data.chunk, structures)
  const chunk: RenderedChunk = {
    key: generated.key,
    coordinate: generated.coordinate,
    origin: generated.origin,
    lod: generated.lod,
    resolution: generated.resolution,
    cell_size: generated.cell_size,
  }
  const mesh = greedy_mesh(generated)
  // Scatter reuses this worker's world + structure plan so the main thread never re-samples
  // columns; only near chunks carry clutter.
  const scatter = data.chunk.lod === 'near' ? chunk_scatter(world, generated.origin, structures) : []
  // Never transfer a zero-length buffer — transferring detaches, and a detached buffer in a
  // later message is a DataCloneError that kills the chunk.
  self.postMessage(
    { id: data.id, result: { chunk, mesh, scatter } },
    { transfer: mesh.quads.length > 0 ? [mesh.quads.buffer] : [] }
  )
})
