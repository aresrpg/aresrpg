// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { create_bounded_memo, type BoundedMemo } from './bounded_memo.ts'
import type { CompiledStructurePack, CompiledStructureType } from './structures.ts'
import { compile_city_placements, map_city } from './cities/index.ts'
import { generated_city_land_use } from './cities/generated_city.ts'
import { field_value, hash_position } from './world_noise.ts'
import { sample_world_column, WORLD_HEIGHT, type CompiledWorld } from './world_recipe.ts'

export type StructureArea = Readonly<{ min_x: number; max_x: number; min_z: number; max_z: number }>
export type StructureBounds = StructureArea & Readonly<{ min_y: number; max_y: number }>
export type StructurePlacement = Readonly<{
  id: string
  pack: string
  type: CompiledStructureType
  origin: readonly [number, number, number]
  rotation: 0 | 1 | 2 | 3
  scale: number
  bounds: StructureBounds
  overlap_bounds: StructureBounds
}>
export type StructureVoxel = Readonly<{ x: number; y: number; z: number; material_id: number }>
export type CityMapOverlay = Readonly<{
  id: string
  bounds: StructureArea
  core: StructureArea
  structures: readonly Readonly<{ id: string; type: string; bounds: StructureArea }>[]
}>

const WORLD_ORIGIN_PORTAL_CLEAR_RADIUS = 10

const rotated_offset = (x: number, z: number, rotation: 0 | 1 | 2 | 3): readonly [number, number] => {
  if (rotation === 1) return [-z, x]
  if (rotation === 2) return [-x, -z]
  if (rotation === 3) return [z, -x]
  return [x, z]
}

const placement_bounds = (
  type: CompiledStructureType,
  origin: readonly [number, number, number],
  rotation: 0 | 1 | 2 | 3,
  scale: number
): StructureBounds => {
  const [width, height, length] = type.size
  const [anchor_x, anchor_y, anchor_z] = type.anchor
  const corners = [
    rotated_offset(-anchor_x * scale, -anchor_z * scale, rotation),
    rotated_offset((width - anchor_x) * scale - 1, -anchor_z * scale, rotation),
    rotated_offset(-anchor_x * scale, (length - anchor_z) * scale - 1, rotation),
    rotated_offset((width - anchor_x) * scale - 1, (length - anchor_z) * scale - 1, rotation),
  ]
  return Object.freeze({
    min_x: origin[0] + Math.min(...corners.map(([x]) => x)),
    max_x: origin[0] + Math.max(...corners.map(([x]) => x)),
    min_y: origin[1] - anchor_y * scale,
    max_y: origin[1] + (height - anchor_y) * scale - 1,
    min_z: origin[2] + Math.min(...corners.map(([, z]) => z)),
    max_z: origin[2] + Math.max(...corners.map(([, z]) => z)),
  })
}

const city_placements = (world: CompiledWorld, area: StructureArea): readonly StructurePlacement[] =>
  Object.freeze(world.structures.cities.flatMap((city) => compile_city_placements(world, city, area)))

export const city_map_overlays = (world: CompiledWorld): readonly CityMapOverlay[] => {
  return Object.freeze(
    world.structures.cities.map((city) =>
      Object.freeze({
        id: city.id,
        bounds: Object.freeze({
          min_x: city.area.min_x,
          max_x: city.area.max_x,
          min_z: city.area.min_z,
          max_z: city.area.max_z,
        }),
        core: Object.freeze({
          min_x: city.area.anchor_x - city.clear_radius,
          max_x: city.area.anchor_x + city.clear_radius,
          min_z: city.area.anchor_z - city.clear_radius,
          max_z: city.area.anchor_z + city.clear_radius,
        }),
        structures: Object.freeze(
          map_city(world, city).map(({ id, type, min_x, max_x, min_z, max_z }) =>
            Object.freeze({ id, type, bounds: Object.freeze({ min_x, max_x, min_z, max_z }) })
          )
        ),
      })
    )
  )
}

const city_clears = (world: CompiledWorld, placement: StructurePlacement): boolean => {
  const city = world.structures.cities.find(
    ({ area }) =>
      placement.bounds.max_x >= area.min_x &&
      placement.bounds.min_x <= area.max_x &&
      placement.bounds.max_z >= area.min_z &&
      placement.bounds.min_z <= area.max_z
  )
  if (!city) return false
  const pack = world.structures.packs.find(({ name }) => name === placement.pack)
  const land_use = generated_city_land_use(city.id, placement.origin[0], placement.origin[2])
  return !pack || !city.preserves_structure(pack.category, land_use)
}

const overlaps = (left: StructureArea, right: StructureArea): boolean =>
  !(left.max_x < right.min_x || left.min_x > right.max_x || left.max_z < right.min_z || left.min_z > right.max_z)

const clears_world_origin_portal_point = (x: number, z: number): boolean =>
  x * x + z * z > WORLD_ORIGIN_PORTAL_CLEAR_RADIUS ** 2

const clears_world_origin_portal = ({ bounds }: StructurePlacement): boolean => {
  const nearest_x = Math.max(bounds.min_x, Math.min(0, bounds.max_x))
  const nearest_z = Math.max(bounds.min_z, Math.min(0, bounds.max_z))
  return clears_world_origin_portal_point(nearest_x, nearest_z)
}

const contains_point = (area: StructureArea, x: number, z: number): boolean =>
  x >= area.min_x && x <= area.max_x && z >= area.min_z && z <= area.max_z
const supports_pack = (pack: CompiledStructurePack, biome: string, fixed: boolean): boolean =>
  fixed || pack.biomes.includes(biome)

const invalid_structure_fit = (heights: readonly number[], max_slope: number, bounds: StructureBounds): boolean =>
  Math.max(...heights) - Math.min(...heights) > max_slope || bounds.min_y < 0 || bounds.max_y >= WORLD_HEIGHT

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
const STRUCTURE_CANDIDATE_CACHE_CAPACITY = 16_384
const candidate_caches = new WeakMap<CompiledWorld, BoundedMemo<string, StructurePlacement | null>>()

const candidate = (
  world: CompiledWorld,
  pack: CompiledStructurePack,
  cell_x: number,
  cell_z: number
): StructurePlacement | null => {
  let cache = candidate_caches.get(world)
  if (!cache) {
    cache = create_bounded_memo(STRUCTURE_CANDIDATE_CACHE_CAPACITY)
    candidate_caches.set(world, cache)
  }
  const key = `${pack.name}:${cell_x}:${cell_z}`
  return cache.get(key, () => compute_candidate(world, pack, cell_x, cell_z))
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
  const fixed = pack.fixed_areas.some((area) => contains_point(area, x, z))
  if (pack.category === 'trees' && grove_value(world, pack, x, z) < 0.2) return null
  const column = sample_world_column(world, x, z)
  if (!supports_pack(pack, column.biome.name, fixed)) return null
  if (pack.category === 'trees' && column.surface_y < world.recipe.sea_level) return null
  const type = weighted_type(pack, hash_position(world.decoration_seed, pack.name, cell_x, cell_z, 0xfd7046c5))
  const rotation = (hash_position(world.decoration_seed, pack.name, cell_x, cell_z, 0xb55a4f09) & 3) as 0 | 1 | 2 | 3
  const scale_range = pack.scale_max - pack.scale_min + 1
  const scale =
    pack.scale_min + (hash_position(world.decoration_seed, pack.name, cell_x, cell_z, 0x6a09e667) % scale_range)
  const provisional = placement_bounds(type, [x, column.surface_y - pack.bury * scale, z], rotation, scale)
  const heights = [
    column.surface_y,
    sample_world_column(world, provisional.min_x, provisional.min_z).surface_y,
    sample_world_column(world, provisional.max_x, provisional.min_z).surface_y,
    sample_world_column(world, provisional.min_x, provisional.max_z).surface_y,
    sample_world_column(world, provisional.max_x, provisional.max_z).surface_y,
  ]
  if (pack.category === 'trees' && Math.min(...heights) < world.recipe.sea_level) return null
  const origin = [x, Math.min(...heights) - pack.bury * scale, z] as const
  const bounds = placement_bounds(type, origin, rotation, scale)
  if (invalid_structure_fit(heights, pack.max_slope, bounds)) return null
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
    scale,
    bounds,
    overlap_bounds,
  })
}

export const structure_placements = (world: CompiledWorld, area: StructureArea): readonly StructurePlacement[] => {
  const candidates = world.structures.packs.flatMap((pack) => {
    const margin = pack.max_footprint * 2
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
  // Generated cities are stored in render chunks, not logical-building placements. Filtering
  // those chunks here cuts houses in half; final voxel emission owns their portal exclusion.
  const cities = city_placements(world, area)
  const accepted = candidates
    .filter(clears_world_origin_portal)
    .sort((left, right) => {
      const size = right.type.footprint * right.scale - left.type.footprint * left.scale
      return size !== 0 ? size : left.id.localeCompare(right.id)
    })
    .reduce<StructurePlacement[]>((result, placement) => {
      if (
        !city_clears(world, placement) &&
        !cities.some(({ overlap_bounds }) => overlaps(overlap_bounds, placement.overlap_bounds)) &&
        !result.some(({ overlap_bounds }) => overlaps(overlap_bounds, placement.overlap_bounds))
      )
        result.push(placement)
      return result
    }, [])
  return Object.freeze(
    [...accepted, ...cities]
      .filter(({ bounds }) => overlaps(bounds, area))
      .sort((left, right) => left.id.localeCompare(right.id))
  )
}

export const for_each_structure_voxel = (
  placement: StructurePlacement,
  visit: (x: number, y: number, z: number, material_id: number) => void,
  world_y_range?: Readonly<{ min: number; max: number }>,
  world_area?: StructureArea
): void => {
  const [anchor_x, anchor_y, anchor_z] = placement.type.anchor
  const min_world_y = world_y_range?.min ?? placement.bounds.min_y
  const max_world_y = world_y_range?.max ?? placement.bounds.max_y
  const min_y = Math.max(
    0,
    Math.floor((min_world_y - placement.origin[1] + anchor_y * placement.scale) / placement.scale)
  )
  const max_y = Math.min(
    placement.type.size[1] - 1,
    Math.floor((max_world_y - placement.origin[1] + anchor_y * placement.scale) / placement.scale)
  )
  if (min_y > max_y) return
  const emit = clears_world_origin_portal(placement)
    ? visit
    : (x: number, y: number, z: number, material_id: number) => {
        if (clears_world_origin_portal_point(x, z)) visit(x, y, z, material_id)
      }
  const start = placement.type.y_offsets[min_y]!
  const end = placement.type.y_offsets[max_y + 1]!
  placement.type.packed_voxels.subarray(start, end).forEach((packed) => {
    const x = packed & 0xff
    const z = (packed >>> 8) & 0xff
    const y = (packed >>> 16) & 0xff
    const material_id = packed >>> 24
    const first = rotated_offset((x - anchor_x) * placement.scale, (z - anchor_z) * placement.scale, placement.rotation)
    const last = rotated_offset(
      (x - anchor_x) * placement.scale + placement.scale - 1,
      (z - anchor_z) * placement.scale + placement.scale - 1,
      placement.rotation
    )
    const min_x = placement.origin[0] + Math.min(first[0], last[0])
    const max_x = placement.origin[0] + Math.max(first[0], last[0])
    const min_z = placement.origin[2] + Math.min(first[1], last[1])
    const max_z = placement.origin[2] + Math.max(first[1], last[1])
    const voxel_area = { min_x, max_x, min_z, max_z }
    if (world_area ? !overlaps(world_area, voxel_area) : false) return
    for (let child_y = 0; child_y < placement.scale; child_y += 1) {
      const world_y = placement.origin[1] + (y - anchor_y) * placement.scale + child_y
      if (world_y < min_world_y || world_y > max_world_y) continue
      for (let child_z = 0; child_z < placement.scale; child_z += 1)
        for (let child_x = 0; child_x < placement.scale; child_x += 1) {
          const [offset_x, offset_z] = rotated_offset(
            (x - anchor_x) * placement.scale + child_x,
            (z - anchor_z) * placement.scale + child_z,
            placement.rotation
          )
          const world_x = placement.origin[0] + offset_x
          const world_z = placement.origin[2] + offset_z
          emit(world_x, world_y, world_z, material_id)
        }
    }
  })
}

export const structure_voxels = (world: CompiledWorld, area: StructureArea): readonly StructureVoxel[] => {
  const voxels: StructureVoxel[] = []
  structure_placements(world, area).forEach((placement) =>
    for_each_structure_voxel(
      placement,
      (x, y, z, material_id) => voxels.push(Object.freeze({ x, y, z, material_id })),
      undefined,
      area
    )
  )
  return Object.freeze(voxels)
}
