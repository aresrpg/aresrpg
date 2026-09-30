// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  CHUNK_EDGE,
  apply_voxel_operation,
  compile_runtime_world_recipe,
  load_generated_city_artifacts_for,
  sample_world_column,
  structure_voxels,
} from '@aresrpg/engine'
import { walkable_spawn_height } from './collision.ts'

export const city_collision_readiness = (
  world: ReturnType<typeof compile_runtime_world_recipe>,
  load_artifacts: typeof load_generated_city_artifacts_for = load_generated_city_artifacts_for,
  on_error: (error: unknown) => void = console.error
): ((area: Readonly<{ min_x: number; max_x: number; min_z: number; max_z: number }>) => boolean) => {
  const ready = new Set<string>()
  const requested = new Set<string>()
  return (area) => {
    const cities = world.structures.cities.filter(
      ({ area: bounds }) =>
        bounds.max_x >= area.min_x &&
        bounds.min_x <= area.max_x &&
        bounds.max_z >= area.min_z &&
        bounds.min_z <= area.max_z
    )
    if (!cities.length) return true
    let complete = true
    for (let x = Math.floor(area.min_x / CHUNK_EDGE); x <= Math.floor(area.max_x / CHUNK_EDGE); x += 1) {
      for (let z = Math.floor(area.min_z / CHUNK_EDGE); z <= Math.floor(area.max_z / CHUNK_EDGE); z += 1) {
        const key = `${x}:${z}`
        if (ready.has(key)) continue
        complete = false
        if (requested.has(key)) continue
        requested.add(key)
        void load_artifacts(cities, {
          min_x: x * CHUNK_EDGE,
          max_x: (x + 1) * CHUNK_EDGE - 1,
          min_z: z * CHUNK_EDGE,
          max_z: (z + 1) * CHUNK_EDGE - 1,
        })
          .then(() => {
            ready.add(key)
            requested.delete(key)
            if (ready.size > 256) ready.delete(ready.values().next().value!)
          })
          .catch(on_error)
      }
    }
    return complete
  }
}

const structure_collision_available = (
  world: ReturnType<typeof compile_runtime_world_recipe>,
  city_ready: boolean
): boolean =>
  (world.structures.packs.length > 0 ||
    world.structures.cities.length > 0 ||
    (world.recipe.fixed_structures?.length ?? 0) > 0) &&
  city_ready

/** One disposable collision projection for players and automatic followers. */
export const create_world_collision = (
  compiled: ReturnType<typeof compile_runtime_world_recipe>,
  on_error: (error: unknown) => void
) => {
  // World oracles for the ported physics/camera: columns are analytic (the compiled recipe), so
  // solidity is "below the surface" and liquid fills up to the authored absolute sea plane — the
  // faithful adaptation until client-side block edits exist (legacy read per-block ids).
  const column_at = (x: number, z: number): ReturnType<typeof sample_world_column> =>
    sample_world_column(compiled, x, z)
  const surface_y = (x: number, z: number): number => column_at(x, z).surface_y
  const structure_chunks = new Map<number, ReadonlyMap<number, number>>()
  const city_artifacts_ready = city_collision_readiness(compiled, load_generated_city_artifacts_for, on_error)
  const structure_material_at = (x: number, y: number, z: number): number | undefined => {
    const block_x = Math.floor(x)
    const block_y = Math.floor(y)
    const block_z = Math.floor(z)
    const chunk_x = Math.floor(block_x / CHUNK_EDGE)
    const chunk_z = Math.floor(block_z / CHUNK_EDGE)
    // The bounded 100k-block world fits signed 16-bit chunk coordinates.
    const key = (chunk_x << 16) | (chunk_z & 0xffff)
    let materials = structure_chunks.get(key)
    if (!materials) {
      const area = {
        min_x: chunk_x * CHUNK_EDGE,
        max_x: (chunk_x + 1) * CHUNK_EDGE - 1,
        min_z: chunk_z * CHUNK_EDGE,
        max_z: (chunk_z + 1) * CHUNK_EDGE - 1,
      }
      // Cached columns were built only after readiness. The compiled world is immutable;
      // repeated voxel probes need neither another area allocation nor another readiness scan.
      if (!structure_collision_available(compiled, city_artifacts_ready(area))) return undefined
      if (structure_chunks.size >= 256) structure_chunks.delete(structure_chunks.keys().next().value!)
      materials = new Map(
        structure_voxels(compiled, area).map(({ x: world_x, y: world_y, z: world_z, material_id }) => [
          (world_y << 10) | ((world_z - chunk_z * CHUNK_EDGE) << 5) | (world_x - chunk_x * CHUNK_EDGE),
          material_id,
        ])
      )
      structure_chunks.set(key, materials)
    }
    return materials.get((block_y << 10) | ((block_z - chunk_z * CHUNK_EDGE) << 5) | (block_x - chunk_x * CHUNK_EDGE))
  }
  const solid_at = (x: number, y: number, z: number): boolean => {
    const operation = structure_material_at(x, y, z)
    return apply_voxel_operation(operation, y < surface_y(x, z) ? 1 : 0) !== 0
  }
  const ground_height = (x: number, z: number, anchor_y = surface_y(x, z)): number =>
    walkable_spawn_height(solid_at, x, anchor_y, z)
  const liquid_at = (x: number, y: number, z: number): boolean => y < compiled.recipe.sea_level && y >= surface_y(x, z)
  return {
    solid_at,
    liquid_at,
    ready: city_artifacts_ready,
    surface_y,
    column_at,
    structure_material_at,
    ground_height,
  }
}
