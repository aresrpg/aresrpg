// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { city_at_position, world_biome_at_zone, worlds_source } from '@aresrpg/engine/data'
import { center_distance, chain_to_client_coordinate, world_size } from '@aresrpg/immutable'
import { ZONE_SIZE } from '@aresrpg/protocol'

import mobs from '../../../seed/content/mobs.json'

import { decode, nonempty, object_schema, world_coordinate, type Schema } from './gameplay_schema.ts'

/** A world, one of its cities or one of its biomes, optionally narrowed to a band of distance from the
 * world centre: the distance the population rule draws group sizes by, taken at the zone's centre. */
export type WorldArea = Readonly<{ world: string; min_distance?: number; max_distance?: number }> &
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
const from_centre = (bound: string): Schema => ({
  ...world_coordinate,
  description: `${bound} distance in blocks from the centre of the WORLD (its portal), never from the city or biome named beside it. Groups grow with it: six mobs at top level far out. A city already fixes its own distance, so a band that misses it leaves no zone and is refused.`,
})
const distance_band = { min_distance: from_centre('Smallest'), max_distance: from_centre('Largest') } as const
/** One place of a world; the distance band is optional on each. */
const area_schema = (place: Readonly<Record<string, Schema>>): Schema => ({
  ...object_schema({ world: nonempty, ...place, ...distance_band }),
  required: ['world', ...Object.keys(place)],
})
export const WORLD_AREA_SCHEMA: Schema = {
  oneOf: [area_schema({}), area_schema({ city: nonempty }), area_schema({ biome: nonempty })],
}
export const parse_world_area = (value: unknown): WorldArea | undefined => {
  if (value === undefined) return undefined
  const area = decode<WorldArea>(WORLD_AREA_SCHEMA, value)
  validate_world_area(area)
  return area
}
const group_size: Schema = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }
const TARGET_OPTIONS_SCHEMA: Schema = {
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
const validate_world_area = (area: WorldArea) => {
  const source = worlds_source.find(({ world }) => world === area.world)
  const exists =
    source &&
    (area.city
      ? source.cities.some(({ city }) => city === area.city)
      : !area.biome || source.terrain?.biomes.some(({ name }) => name === area.biome))
  if (!exists || !band_ordered(area)) throw new Error('invalid_target_options')
  if (!area_has_zone(area)) throw new Error('area_has_no_zone')
}
const band_ordered = ({ min_distance = 0, max_distance = world_size }: WorldArea) => min_distance <= max_distance
/** A zone belongs to a distance band by its centre, as the population rule sizes its groups. */
const band_contains = (
  { min_distance = 0, max_distance = world_size }: WorldArea,
  zone_x: number,
  zone_z: number
): boolean => {
  const distance = center_distance((zone_x + 0.5) * ZONE_SIZE, (zone_z + 0.5) * ZONE_SIZE)
  return distance >= min_distance && distance <= max_distance
}
/**
 * Whether a chain position lies inside a place: the one rule the bot fences targets and travel with.
 * A city is its footprint; a biome is the land outside cities, taken by zone, so a zone whose centre
 * is in a city belongs to that city.
 */
export const area_contains = (area: WorldArea, world: string, x: number, z: number): boolean => {
  if (world !== area.world || ![x, z].every((value) => Number.isFinite(value) && value >= 0 && value < world_size))
    return false
  const zone_x = Math.floor(x / ZONE_SIZE)
  const zone_z = Math.floor(z / ZONE_SIZE)
  if (!band_contains(area, zone_x, zone_z)) return false
  const city_of = (at_x: number, at_z: number) =>
    city_at_position(world, chain_to_client_coordinate(at_x), chain_to_client_coordinate(at_z))
  if (area.city) return city_of(x, z)?.id === area.city
  if (!area.biome) return true
  if (city_of((zone_x + 0.5) * ZONE_SIZE, (zone_z + 0.5) * ZONE_SIZE)) return false
  return world_biome_at_zone(world, zone_x, zone_z) === area.biome
}
const GRID_SIDE = Math.ceil(world_size / ZONE_SIZE)
const zone_exists = new Map<string, boolean>()
/** Whether any zone of its world belongs to an area. A place nothing belongs to is a mistake of its
 * author: it is refused when the tree is checked, instead of holding a run that can never move. */
const area_has_zone = (area: WorldArea): boolean => {
  const key = JSON.stringify([area.world, area.city, area.biome, area.min_distance, area.max_distance])
  const known = zone_exists.get(key)
  if (known !== undefined) return known
  const centre = (index: number) => (index + 0.5) * ZONE_SIZE
  const side = Array.from({ length: GRID_SIDE }, (_, index) => index)
  const found = side.some((zx) => side.some((zz) => area_contains(area, area.world, centre(zx), centre(zz))))
  zone_exists.set(key, found)
  return found
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
  // A city footprint is a convex rectangle; a distance band fences both ends of a walk, not its line.
  if (!area.biome) return true
  const times = [0, ...axis_crossings(from[0], to[0]), ...axis_crossings(from[1], to[1]), 1].toSorted((a, b) => a - b)
  const at = (time: number) =>
    area_contains(area, world, from[0] + (to[0] - from[0]) * time, from[1] + (to[1] - from[1]) * time)
  return times.every((time, index) => at(time) && (index === 0 || at((time + times[index - 1]!) / 2)))
}
