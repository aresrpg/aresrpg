// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { CompiledStructurePack, CompiledStructureType } from './structures.ts'
import { field_value, hash_position } from './world_noise.ts'
import { sample_world_column, type CompiledWorld } from './world_recipe.ts'

export type StructureArea = Readonly<{ min_x: number; max_x: number; min_z: number; max_z: number }>
export type StructureBounds = StructureArea & Readonly<{ min_y: number; max_y: number }>
export type StructurePlacement = Readonly<{
  id: string
  pack: string
  type: CompiledStructureType
  origin: readonly [number, number, number]
  rotation: 0 | 1 | 2 | 3
  bounds: StructureBounds
  overlap_bounds: StructureBounds
}>
export type StructureVoxel = Readonly<{ x: number; y: number; z: number; material_id: number }>

const rotated_offset = (x: number, z: number, rotation: 0 | 1 | 2 | 3): readonly [number, number] => {
  if (rotation === 1) return [-z, x]
  if (rotation === 2) return [-x, -z]
  if (rotation === 3) return [z, -x]
  return [x, z]
}

const placement_bounds = (
  type: CompiledStructureType,
  origin: readonly [number, number, number],
  rotation: 0 | 1 | 2 | 3
): StructureBounds => {
  const [width, height, length] = type.size
  const [anchor_x, , anchor_z] = type.anchor
  const corners = [
    rotated_offset(-anchor_x, -anchor_z, rotation),
    rotated_offset(width - 1 - anchor_x, -anchor_z, rotation),
    rotated_offset(-anchor_x, length - 1 - anchor_z, rotation),
    rotated_offset(width - 1 - anchor_x, length - 1 - anchor_z, rotation),
  ]
  return Object.freeze({
    min_x: origin[0] + Math.min(...corners.map(([x]) => x)),
    max_x: origin[0] + Math.max(...corners.map(([x]) => x)),
    min_y: origin[1],
    max_y: origin[1] + height - 1,
    min_z: origin[2] + Math.min(...corners.map(([, z]) => z)),
    max_z: origin[2] + Math.max(...corners.map(([, z]) => z)),
  })
}

const overlaps = (left: StructureArea, right: StructureArea): boolean =>
  !(left.max_x < right.min_x || left.min_x > right.max_x || left.max_z < right.min_z || left.min_z > right.max_z)

const grove_value = (world: CompiledWorld, pack: CompiledStructurePack, x: number, z: number): number =>
  field_value(world.decoration_seed, pack.name, x, z, 256, 0x94d049bb)

const weighted_type = (pack: CompiledStructurePack, roll: number): CompiledStructureType => {
  let remaining = roll % pack.weight_sum
  return (
    pack.types.find(({ weight }) => {
      if (remaining < weight) return true
      remaining -= weight
      return false
    }) ?? pack.types.at(-1)!
  ).type
}

/** Cell memo — a candidate is a pure function of (world, pack, cell); every chunk whose search
 *  margin covers the cell re-asks the exact same question, so the answer is computed once. */
const candidate_caches = new WeakMap<CompiledWorld, Map<string, StructurePlacement | null>>()

const candidate = (
  world: CompiledWorld,
  pack: CompiledStructurePack,
  cell_x: number,
  cell_z: number
): StructurePlacement | null => {
  let cache = candidate_caches.get(world)
  if (!cache) {
    cache = new Map()
    candidate_caches.set(world, cache)
  }
  const key = `${pack.name}:${cell_x}:${cell_z}`
  const cached = cache.get(key)
  if (cached !== undefined) return cached
  if (cache.size >= 65_536) cache.clear()
  const placement = compute_candidate(world, pack, cell_x, cell_z)
  cache.set(key, placement)
  return placement
}

const compute_candidate = (
  world: CompiledWorld,
  pack: CompiledStructurePack,
  cell_x: number,
  cell_z: number
): StructurePlacement | null => {
  const chance = hash_position(world.decoration_seed, pack.name, cell_x, cell_z, 0x27d4eb2f)
  if (chance % 10_000 >= pack.density_bp) return null
  const jitter_x = hash_position(world.decoration_seed, pack.name, cell_x, cell_z, 0x165667b1) % pack.spacing
  const jitter_z = hash_position(world.decoration_seed, pack.name, cell_x, cell_z, 0xd3a2646c) % pack.spacing
  const x = cell_x * pack.spacing + jitter_x
  const z = cell_z * pack.spacing + jitter_z
  if (pack.category === 'trees' && grove_value(world, pack, x, z) < 0.2) return null
  const column = sample_world_column(world, x, z)
  if (!pack.biomes.includes(column.biome.name)) return null
  if (pack.category === 'trees' && column.surface_y < world.recipe.sea_level) return null
  const type = weighted_type(pack, hash_position(world.decoration_seed, pack.name, cell_x, cell_z, 0xfd7046c5))
  const rotation = (hash_position(world.decoration_seed, pack.name, cell_x, cell_z, 0xb55a4f09) & 3) as 0 | 1 | 2 | 3
  const provisional = placement_bounds(type, [x, column.surface_y - pack.bury, z], rotation)
  const heights = [
    column.surface_y,
    sample_world_column(world, provisional.min_x, provisional.min_z).surface_y,
    sample_world_column(world, provisional.max_x, provisional.min_z).surface_y,
    sample_world_column(world, provisional.min_x, provisional.max_z).surface_y,
    sample_world_column(world, provisional.max_x, provisional.max_z).surface_y,
  ]
  if (pack.category === 'trees' && Math.min(...heights) < world.recipe.sea_level) return null
  if (Math.max(...heights) - Math.min(...heights) > pack.max_slope) return null
  const origin = [x, Math.min(...heights) - pack.bury, z] as const
  const bounds = placement_bounds(type, origin, rotation)
  const tree_radius = 2
  const overlap_bounds =
    pack.category === 'trees'
      ? Object.freeze({
          min_x: x - tree_radius,
          max_x: x + tree_radius,
          min_y: bounds.min_y,
          max_y: bounds.max_y,
          min_z: z - tree_radius,
          max_z: z + tree_radius,
        })
      : bounds
  return Object.freeze({
    id: `${pack.name}:${cell_x}:${cell_z}`,
    pack: pack.name,
    type,
    origin,
    rotation,
    bounds,
    overlap_bounds,
  })
}

export const structure_placements = (world: CompiledWorld, area: StructureArea): readonly StructurePlacement[] => {
  const margin = world.structures.max_footprint * 2
  const candidates = world.structures.packs.flatMap((pack) => {
    const min_cell_x = Math.floor((area.min_x - margin) / pack.spacing)
    const max_cell_x = Math.floor((area.max_x + margin) / pack.spacing)
    const min_cell_z = Math.floor((area.min_z - margin) / pack.spacing)
    const max_cell_z = Math.floor((area.max_z + margin) / pack.spacing)
    const placements: StructurePlacement[] = []
    for (let cell_z = min_cell_z; cell_z <= max_cell_z; cell_z += 1)
      for (let cell_x = min_cell_x; cell_x <= max_cell_x; cell_x += 1) {
        const placement = candidate(world, pack, cell_x, cell_z)
        if (placement) placements.push(placement)
      }
    return placements
  })
  const accepted = [...candidates]
    .sort((left, right) => {
      const size = right.type.footprint - left.type.footprint
      return size !== 0 ? size : left.id.localeCompare(right.id)
    })
    .reduce<StructurePlacement[]>((result, placement) => {
      if (!result.some(({ overlap_bounds }) => overlaps(overlap_bounds, placement.overlap_bounds)))
        result.push(placement)
      return result
    }, [])
    .filter(({ bounds }) => overlaps(bounds, area))
    .sort((left, right) => left.id.localeCompare(right.id))
  return Object.freeze(accepted)
}

export const for_each_structure_voxel = (
  placement: StructurePlacement,
  visit: (x: number, y: number, z: number, material_id: number) => void,
  world_y_range?: Readonly<{ min: number; max: number }>
): void => {
  const [anchor_x, anchor_y, anchor_z] = placement.type.anchor
  const min_y = Math.max(0, Math.ceil((world_y_range?.min ?? placement.bounds.min_y) - placement.origin[1] + anchor_y))
  const max_y = Math.min(
    placement.type.size[1] - 1,
    Math.floor((world_y_range?.max ?? placement.bounds.max_y) - placement.origin[1] + anchor_y)
  )
  if (min_y > max_y) return
  const start = placement.type.y_offsets[min_y]!
  const end = placement.type.y_offsets[max_y + 1]!
  placement.type.packed_voxels.subarray(start, end).forEach((packed) => {
    const x = packed & 0xff
    const z = (packed >>> 8) & 0xff
    const y = (packed >>> 16) & 0xff
    const material_id = packed >>> 24
    const [offset_x, offset_z] = rotated_offset(x - anchor_x, z - anchor_z, placement.rotation)
    visit(
      placement.origin[0] + offset_x,
      placement.origin[1] + y - anchor_y,
      placement.origin[2] + offset_z,
      material_id
    )
  })
}

export const structure_voxels = (world: CompiledWorld, area: StructureArea): readonly StructureVoxel[] => {
  const voxels: StructureVoxel[] = []
  structure_placements(world, area).forEach((placement) =>
    for_each_structure_voxel(placement, (x, y, z, material_id) => {
      if (x < area.min_x || x > area.max_x || z < area.min_z || z > area.max_z) return
      voxels.push(Object.freeze({ x, y, z, material_id }))
    })
  )
  return Object.freeze(voxels)
}
