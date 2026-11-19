// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { city_at_position, client_world_position, world_biome_at_zone, worlds_source } from '@aresrpg/engine/data'
import { world_size } from '@aresrpg/immutable'
import { ZONE_SIZE } from '@aresrpg/protocol'

import mobs from '../../../seed/content/mobs.json'

import { decode, nonempty, object_schema, type Schema } from './gameplay_schema.ts'

export type WorldArea = Readonly<{ world: string }> &
  (
    | Readonly<{ city?: never; biome?: never }>
    | Readonly<{ city: string; biome?: never }>
    | Readonly<{ biome: string; city?: never }>
  )
export type TargetOptions = Readonly<{
  min_size?: number
  max_size?: number
  mob_types?: readonly string[]
  area?: WorldArea
}>
export const WORLD_AREA_SCHEMA: Schema = {
  oneOf: [
    object_schema({ world: nonempty }),
    object_schema({ world: nonempty, city: nonempty }),
    object_schema({ world: nonempty, biome: nonempty }),
  ],
}
export const parse_world_area = (value: unknown): WorldArea | undefined => {
  if (value === undefined) return undefined
  const area = decode<WorldArea>(WORLD_AREA_SCHEMA, value)
  validate_world_area(area)
  return area
}
const group_size: Schema = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }
export const TARGET_OPTIONS_SCHEMA: Schema = {
  ...object_schema({
    min_size: group_size,
    max_size: group_size,
    mob_types: { type: 'array', minItems: 1, uniqueItems: true, items: nonempty },
    area: WORLD_AREA_SCHEMA,
  }),
  required: [],
}
/** Optional constraints add no default bounds to existing external scripts. */
export const target_schema = (properties: Readonly<Record<string, Schema>>): Schema => ({
  ...object_schema({ ...properties, target_options: TARGET_OPTIONS_SCHEMA }),
  required: Object.keys(properties),
})
export const parse_target_options = (value: unknown): TargetOptions | undefined => {
  if (value === undefined) return undefined
  const options = decode<TargetOptions>(TARGET_OPTIONS_SCHEMA, value)
  if ((options.min_size ?? 1) > (options.max_size ?? Number.MAX_SAFE_INTEGER)) throw new Error('invalid_target_options')
  if (options.mob_types?.some((type) => !mobs.some(({ mob_type }) => mob_type === type)))
    throw new Error('invalid_target_options')
  if (options.area) validate_world_area(options.area)
  return options
}
export const validate_world_area = (area: WorldArea) => {
  const source = worlds_source.find(({ world }) => world === area.world)
  const exists =
    source &&
    (area.city
      ? source.cities.some(({ city }) => city === area.city)
      : !area.biome || source.terrain?.biomes.some(({ name }) => name === area.biome))
  if (!exists) throw new Error('invalid_target_options')
}
export const area_contains = (area: WorldArea, world: string, x: number, z: number): boolean => {
  if (world !== area.world || ![x, z].every((value) => Number.isFinite(value) && value >= 0 && value < world_size))
    return false
  if (area.city) return city_at_position(world, ...client_world_position(x, z))?.id === area.city
  if (!area.biome) return true
  const zx = Math.floor(x / ZONE_SIZE)
  const zz = Math.floor(z / ZONE_SIZE)
  if (city_at_position(world, ...client_world_position((zx + 0.5) * ZONE_SIZE, (zz + 0.5) * ZONE_SIZE))) return false
  return world_biome_at_zone(world, zx, zz) === area.biome
}
export const assert_area_position = (area: WorldArea | undefined, world: string, x: number, z: number) => {
  if (area && !area_contains(area, world, x, z)) throw new Error('target_outside_area')
}
export const group_matches = (types: readonly string[], options: TargetOptions = {}): boolean => {
  const { min_size = 1, max_size = Number.MAX_SAFE_INTEGER, mob_types } = options
  return (
    types.length >= min_size &&
    types.length <= max_size &&
    (!mob_types || types.every((type) => mob_types.includes(type)))
  )
}
/** Transport authored constraints with the selected ordinary command, without a second policy store. */
export const target_fields = (options: TargetOptions | undefined) => (options ? { target_options: options } : {})
export const assert_target_context = (
  options: TargetOptions | undefined,
  character: Readonly<{ world?: string | null; x?: number | null; z?: number | null }>,
  encounter: Readonly<{ world: string; x: number; z: number; types: readonly string[] }>
) => {
  if (!options) return undefined
  assert_area_position(options.area, character.world!, character.x!, character.z!)
  assert_area_position(options.area, encounter.world, encounter.x, encounter.z)
  if (!group_matches(encounter.types, options)) throw new Error('target_group_mismatch')
  return options.area
}

const axis_crossings = (from: number, to: number): readonly number[] => {
  if (from === to) return []
  const first = Math.floor(Math.min(from, to) / ZONE_SIZE) + 1
  const last = Math.floor(Math.max(from, to) / ZONE_SIZE)
  return Array.from(
    { length: Math.max(0, last - first + 1) },
    (_, index) => ((first + index) * ZONE_SIZE - from) / (to - from)
  )
}
/** Check every crossed canonical biome cell, not fixed-distance samples that can skip a thin crossing. */
export const area_allows_segment = (
  area: WorldArea | undefined,
  world: string,
  from: readonly [number, number],
  to: readonly [number, number]
): boolean => {
  if (!area) return true
  if (![from, to].every(([x, z]) => area_contains(area, world, x, z))) return false
  if (!area.biome) return true // The canonical city footprint is a convex rectangle.
  const times = [0, ...axis_crossings(from[0], to[0]), ...axis_crossings(from[1], to[1]), 1].toSorted((a, b) => a - b)
  const at = (time: number) =>
    area_contains(area, world, from[0] + (to[0] - from[0]) * time, from[1] + (to[1] - from[1]) * time)
  return times.every((time, index) => at(time) && (index === 0 || at((time + times[index - 1]!) / 2)))
}
