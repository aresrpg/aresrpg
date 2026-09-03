// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { StructurePlacement } from '../structure_placement.ts'
import type { CompiledStructureType } from '../structures.ts'
import type { CompiledWorld } from '../world_recipe.ts'
import type { CompiledMaterials } from '../world_materials.ts'

import { generated_city_surface_height } from './city_terrain.ts'
import { CITY_DEFINITIONS, city_definition } from './registry.ts'
import type { CityMapStructure, CompiledCity, GeneratedCityArtifact } from './types.ts'

const CHUNK_EDGE = 32
type GeneratedChunk = GeneratedCityArtifact['chunks'][number]
const GENERATED_MAPS = Object.freeze(Object.fromEntries(CITY_DEFINITIONS.map(({ id, map }) => [id, map])))
const GENERATED_SKY_CELL = 16
const land_use_entries = (
  city: GeneratedCityArtifact['area'],
  structure: CityMapStructure,
  land_use: string
): readonly (readonly [string, string])[] => {
  const min_x = Math.floor((structure.min_x - city.min_x) / GENERATED_SKY_CELL)
  const max_x = Math.floor((structure.max_x - city.min_x) / GENERATED_SKY_CELL)
  const min_z = Math.floor((structure.min_z - city.min_z) / GENERATED_SKY_CELL)
  const max_z = Math.floor((structure.max_z - city.min_z) / GENERATED_SKY_CELL)
  const width = max_x - min_x + 1
  return Object.freeze(
    Array.from({ length: width * (max_z - min_z + 1) }, (_, index) => {
      const x = min_x + (index % width)
      const z = min_z + Math.floor(index / width)
      return [`${city.id}:${x}:${z}`, land_use] as const
    })
  )
}

const LAND_USE_CELLS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    CITY_DEFINITIONS.flatMap((definition) => {
      const city = definition.map
      return city.map
        .filter(({ type }) => definition.land_uses[type] !== undefined)
        .flatMap((structure) => land_use_entries(city.area, structure, definition.land_uses[structure.type]!))
    })
  )
)
const generated_cities = new Map<string, GeneratedCityArtifact>()
const loading = new Map<string, Promise<void>>()
type HorizontalArea = Readonly<{ min_x: number; max_x: number; min_z: number; max_z: number }>
type AuthoredCityArea = HorizontalArea & Readonly<{ id: string }>
const placement_caches = new WeakMap<CompiledWorld, Map<string, StructurePlacement>>()

export const generated_city_land_use = (city_id: string, x: number, z: number): string | null => {
  const city = GENERATED_MAPS[city_id]
  if (!city) return null
  const cell_x = Math.floor((x - city.area.min_x) / GENERATED_SKY_CELL)
  const cell_z = Math.floor((z - city.area.min_z) / GENERATED_SKY_CELL)
  return LAND_USE_CELLS[`${city_id}:${cell_x}:${cell_z}`] ?? null
}

export const generated_city_surface_y = (
  cities: readonly AuthoredCityArea[],
  x: number,
  z: number,
  surface_y: number
): number => {
  const city = cities.find(({ min_x, max_x, min_z, max_z }) => x >= min_x && x <= max_x && z >= min_z && z <= max_z)
  const generated = city ? GENERATED_MAPS[city.id] : null
  return generated ? generated_city_surface_height(generated.terrain, x, z, surface_y) : surface_y
}

const load_json = async <T>(url: URL): Promise<T> => {
  if (typeof Bun !== 'undefined') return Bun.file(url).json() as Promise<T>
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Generated city artifact failed to load: ${response.status}`)
  return response.json() as Promise<T>
}

const load_generated_city_artifact = (id: string): Promise<void> => {
  const pending = loading.get(id)
  if (pending) return pending
  const definition = city_definition(id)
  if (!definition) return Promise.resolve()
  const next = load_json<GeneratedCityArtifact>(definition.artifact_url).then((artifact) => {
    if (artifact.id !== id || definition.map.source_hash !== artifact.source_hash)
      throw new TypeError(`Generated ${id} voxel and map artifacts do not share provenance`)
    generated_cities.set(id, Object.freeze(artifact))
  })
  loading.set(id, next)
  return next
}

export const load_generated_city_artifacts = (): Promise<void> =>
  Promise.all(CITY_DEFINITIONS.map(({ id }) => load_generated_city_artifact(id))).then(() => undefined)

const overlaps_area = (left: HorizontalArea, right: HorizontalArea): boolean =>
  !(left.max_x < right.min_x || left.min_x > right.max_x || left.max_z < right.min_z || left.min_z > right.max_z)

export const generated_city_intersects = (cities: readonly CompiledCity[], area: HorizontalArea): boolean =>
  cities.some((city) => GENERATED_MAPS[city.id] !== undefined && overlaps_area(city.area, area))

export const load_generated_city_artifacts_for = (
  cities: readonly CompiledCity[],
  area: HorizontalArea
): Promise<void> =>
  Promise.all(
    cities
      .filter((city) => GENERATED_MAPS[city.id] !== undefined && overlaps_area(city.area, area))
      .map(({ id }) => load_generated_city_artifact(id))
  ).then(() => undefined)

const assert_matching_area = (city: CompiledCity, artifact: Pick<GeneratedCityArtifact, 'id' | 'area'>): void => {
  const authored = city.area
  const generated = artifact.area
  if (
    authored.min_x !== generated.min_x ||
    authored.max_x !== generated.max_x ||
    authored.min_z !== generated.min_z ||
    authored.max_z !== generated.max_z ||
    authored.anchor_x !== generated.anchor_x ||
    authored.anchor_z !== generated.anchor_z
  )
    throw new TypeError(`Generated ${city.id} artifact does not match its authored city area`)
}

const decode_bytes = (encoded: string): Uint8Array =>
  Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))

const compile_chunk_type = (
  city: CompiledCity,
  chunk: GeneratedChunk,
  materials: CompiledMaterials
): Readonly<{
  type: CompiledStructureType
  local_bounds: readonly [number, number, number, number, number, number]
}> => {
  const palette = chunk.palette.map((material) => (material === 'air' ? 0 : materials.id_for(material)))
  const bytes = decode_bytes(chunk.runs)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const packed_voxels = new Uint32Array(chunk.voxels)
  const y_counts = new Uint32Array(CHUNK_EDGE)
  let cursor = 0
  let min_x = CHUNK_EDGE
  let min_y = CHUNK_EDGE
  let min_z = CHUNK_EDGE
  let max_x = 0
  let max_y = 0
  let max_z = 0
  for (let run = 0; run < bytes.length; run += 5) {
    const start = view.getUint16(run, true)
    const count = view.getUint16(run + 2, true)
    const material_id = palette[view.getUint8(run + 4)]!
    for (let offset = 0; offset < count; offset += 1) {
      const linear = start + offset
      const x = linear % CHUNK_EDGE
      const z = Math.floor(linear / CHUNK_EDGE) % CHUNK_EDGE
      const y = Math.floor(linear / (CHUNK_EDGE * CHUNK_EDGE))
      packed_voxels[cursor] = ((material_id & 0xff) << 24) | (y << 16) | (z << 8) | x
      y_counts[y] += 1
      cursor += 1
      min_x = Math.min(min_x, x)
      min_y = Math.min(min_y, y)
      min_z = Math.min(min_z, z)
      max_x = Math.max(max_x, x)
      max_y = Math.max(max_y, y)
      max_z = Math.max(max_z, z)
    }
  }
  if (cursor !== chunk.voxels)
    throw new TypeError(`Generated ${city.id} chunk decoded ${cursor}/${chunk.voxels} voxels`)
  const y_offsets = new Uint32Array(CHUNK_EDGE + 1)
  y_counts.forEach((count, y) => {
    y_offsets[y + 1] = y_offsets[y]! + count
  })
  return Object.freeze({
    type: Object.freeze({
      name: `${city.id}_chunk_${chunk.x}_${chunk.y}_${chunk.z}`,
      size: [CHUNK_EDGE, CHUNK_EDGE, CHUNK_EDGE] as const,
      anchor: [0, 0, 0] as const,
      packed_voxels,
      y_offsets,
      footprint: CHUNK_EDGE,
    }),
    local_bounds: Object.freeze([min_x, max_x, min_y, max_y, min_z, max_z] as const),
  })
}

const compile_chunk_placement = (
  city: CompiledCity,
  chunk: GeneratedChunk,
  materials: CompiledMaterials
): StructurePlacement => {
  const { type, local_bounds } = compile_chunk_type(city, chunk, materials)
  const [min_x, max_x, min_y, max_y, min_z, max_z] = local_bounds
  const origin = [chunk.x * CHUNK_EDGE, chunk.y * CHUNK_EDGE, chunk.z * CHUNK_EDGE] as const
  const bounds = Object.freeze({
    min_x: origin[0] + min_x,
    max_x: origin[0] + max_x,
    min_y: origin[1] + min_y,
    max_y: origin[1] + max_y,
    min_z: origin[2] + min_z,
    max_z: origin[2] + max_z,
  })
  return Object.freeze({
    id: `city:${city.id}:chunk:${chunk.x}:${chunk.y}:${chunk.z}`,
    pack: `city:${city.id}`,
    type,
    origin,
    rotation: 0,
    scale: 1,
    bounds,
    overlap_bounds: bounds,
  })
}

const chunk_overlaps = (chunk: GeneratedChunk, area: HorizontalArea): boolean => {
  const min_x = chunk.x * CHUNK_EDGE
  const min_z = chunk.z * CHUNK_EDGE
  return (
    min_x <= area.max_x &&
    min_x + CHUNK_EDGE - 1 >= area.min_x &&
    min_z <= area.max_z &&
    min_z + CHUNK_EDGE - 1 >= area.min_z
  )
}

const cached_chunk_placement = (
  world: CompiledWorld,
  city: CompiledCity,
  chunk: GeneratedChunk
): StructurePlacement => {
  let cache = placement_caches.get(world)
  if (!cache) {
    cache = new Map()
    placement_caches.set(world, cache)
  }
  const key = `${city.id}:${chunk.x}:${chunk.y}:${chunk.z}`
  const cached = cache.get(key)
  if (cached) return cached
  const placement = compile_chunk_placement(city, chunk, world.materials)
  cache.set(key, placement)
  return placement
}

export const generated_city_placements = (
  world: CompiledWorld,
  city: CompiledCity,
  area: HorizontalArea
): readonly StructurePlacement[] => {
  if (!overlaps_area(city.area, area)) return Object.freeze([])
  const artifact = generated_cities.get(city.id)
  if (!artifact) throw new TypeError(`Generated ${city.id} voxels were not loaded before terrain planning`)
  assert_matching_area(city, artifact)
  return Object.freeze(
    artifact.chunks
      .filter((chunk) => chunk_overlaps(chunk, area))
      .map((chunk) => cached_chunk_placement(world, city, chunk))
  )
}

export const generated_city_map = (city: CompiledCity): readonly CityMapStructure[] => {
  const artifact = GENERATED_MAPS[city.id]
  if (!artifact) return Object.freeze([])
  assert_matching_area(city, artifact)
  return artifact.map
}
