// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { surface_chunk_layers } from './terrain_generator.ts'
import { load_generated_city_artifacts_for } from './cities/generated_city.ts'
import { structure_placements } from './structure_placement.ts'
import { CHUNK_EDGE } from './voxel_data.ts'
import type { TerrainColumnCoordinate, TerrainColumnPlan } from './terrain_planner.ts'
import { compile_runtime_world_recipe, type CompiledWorld, type WorldRecipe } from './world_recipe.ts'

type WorkerRequest =
  | Readonly<{ type: 'initialize'; world: WorldRecipe }>
  | Readonly<{ type: 'plan'; id: number; columns: readonly TerrainColumnCoordinate[] }>

let world_ready: Promise<CompiledWorld> | null = null

self.addEventListener('message', ({ data }: MessageEvent<WorkerRequest>) => {
  if (data.type === 'initialize') {
    world_ready = Promise.resolve(compile_runtime_world_recipe(data.world))
    return
  }
  if (!world_ready) throw new Error('terrain planner received work before its world recipe')
  void world_ready
    .then(async (compiled) => {
      const min_x = Math.min(...data.columns.map(({ x }) => x)) * CHUNK_EDGE
      const max_x = (Math.max(...data.columns.map(({ x }) => x)) + 1) * CHUNK_EDGE - 1
      const min_z = Math.min(...data.columns.map(({ z }) => z)) * CHUNK_EDGE
      const max_z = (Math.max(...data.columns.map(({ z }) => z)) + 1) * CHUNK_EDGE - 1
      const area = { min_x, max_x, min_z, max_z }
      await load_generated_city_artifacts_for(compiled.structures.cities, area)
      const structures = structure_placements(compiled, area)
      const plans: readonly TerrainColumnPlan[] = data.columns.map(({ x, z }) => ({
        x,
        z,
        layers: surface_chunk_layers(compiled, x, z, structures),
      }))
      self.postMessage({ id: data.id, plans })
    })
    .catch((error: unknown) => {
      console.error('Terrain planner city initialization failed.', error)
      throw error
    })
})
