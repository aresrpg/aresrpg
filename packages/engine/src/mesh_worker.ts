// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { greedy_mesh } from './greedy_mesher.ts'
import { generate_chunk } from './terrain_generator.ts'
import type { RenderChunkRequest, RenderedChunk } from './types.ts'
import { compile_world_recipe, type CompiledWorld, type WorldRecipe } from './world_recipe.ts'

type WorkerRequest =
  | Readonly<{ type: 'initialize'; world: WorldRecipe }>
  | Readonly<{ type: 'mesh'; id: number; chunk: RenderChunkRequest }>

let world: CompiledWorld | null = null

self.addEventListener('message', ({ data }: MessageEvent<WorkerRequest>) => {
  if (data.type === 'initialize') {
    world = compile_world_recipe(data.world)
    return
  }
  if (!world) throw new Error('mesh worker received work before its world recipe')
  const generated = generate_chunk(world, data.chunk)
  const chunk: RenderedChunk = {
    key: generated.key,
    coordinate: generated.coordinate,
    origin: generated.origin,
    lod: generated.lod,
    resolution: generated.resolution,
    cell_size: generated.cell_size,
  }
  const mesh = greedy_mesh(generated)
  // Never transfer a zero-length buffer — transferring detaches, and a detached buffer in a
  // later message is a DataCloneError that kills the chunk.
  self.postMessage(
    { id: data.id, result: { chunk, mesh } },
    { transfer: mesh.quads.length > 0 ? [mesh.quads.buffer] : [] }
  )
})
