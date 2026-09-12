// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { chain_to_client_coordinate, world_size } from '@aresrpg/immutable'
import { ZONE_SIZE, ZONE_RESEARCH_TTL_MS, zone_of } from '@aresrpg/protocol'

import { content_catalog, type WorldResource } from '../content/catalog.ts'
import { city_at_position, world_biome_at_zone } from '../content/worlds.ts'
import { resource_node_id } from '../game/resource_nodes.ts'

import type { WorldState } from './world.ts'
import { live_spawns, resource_pack_id } from './world_spawns.ts'

export type AutomationTarget = Readonly<{
  key: string
  x: number
  z: number
  node: string | null
}>
export type VisitedZones = Readonly<Record<string, number>>
export type RouteContext = Readonly<{
  world: string
  resource: WorldResource
  zones: WorldState
  visited: VisitedZones
  now_ms: number
  x: number
  z: number
}>

export const automation_zone_key = (world: string, x: number, z: number): string => {
  const { zx, zz } = zone_of(x, z)
  return `${world}:${zx}:${zz}`
}

export const resource_location_eligible = (
  resource: WorldResource,
  city: string | null,
  biome: string | null
): boolean => (city !== null ? resource.cities.includes(city) : biome !== null && resource.biomes.includes(biome))

export const zone_resource_eligible = (world: string, resource: WorldResource, zx: number, zz: number): boolean => {
  const x = Math.min(world_size - 1, zx * ZONE_SIZE + ZONE_SIZE / 2)
  const z = Math.min(world_size - 1, zz * ZONE_SIZE + ZONE_SIZE / 2)
  const city = city_at_position(world, chain_to_client_coordinate(x), chain_to_client_coordinate(z))
  return resource_location_eligible(resource, city?.id ?? null, city ? null : world_biome_at_zone(world, zx, zz))
}

export const nearest_resource = (context: RouteContext, key: string): AutomationTarget | null => {
  const zone = context.zones.zones[key]
  if (!zone) return null
  const [pack] = live_spawns(context.zones, key)
    .resources.filter(({ item_type }) => item_type === context.resource.item_type)
    .toSorted(
      (a, b) =>
        Math.hypot(a.x - context.x, a.z - context.z) - Math.hypot(b.x - context.x, b.z - context.z) || a.index - b.index
    )
  return pack
    ? { key, x: pack.x, z: pack.z, node: resource_node_id(resource_pack_id(key, zone.seed, pack.index), 0) }
    : null
}

export const remember_empty_zone = (context: RouteContext, key: string): VisitedZones => ({
  ...Object.fromEntries(Object.entries(context.visited).filter(([, until]) => until > context.now_ms)),
  [key]: context.zones.zones[key]!.searched_at_ms + ZONE_RESEARCH_TTL_MS,
})

const candidate_zone = (
  context: RouteContext,
  zx: number,
  zz: number,
  eligible: typeof zone_resource_eligible
): AutomationTarget | null => {
  const count = Math.ceil(world_size / ZONE_SIZE)
  if ([zx, zz].some((coordinate) => coordinate < 0 || coordinate >= count)) return null
  const key = `${context.world}:${zx}:${zz}`
  if ((context.visited[key] ?? 0) > context.now_ms || !eligible(context.world, context.resource, zx, zz)) return null
  const resource = nearest_resource(context, key)
  if (resource) return resource
  const zone = context.zones.zones[key]
  if (zone && context.zones.spawns[key] && zone.searched_at_ms + ZONE_RESEARCH_TTL_MS > context.now_ms) return null
  return {
    key,
    x: Math.min(world_size - 1, zx * ZONE_SIZE + ZONE_SIZE / 2),
    z: Math.min(world_size - 1, zz * ZONE_SIZE + ZONE_SIZE / 2),
    node: null,
  }
}

/** Four half-open edges visit each perimeter cell exactly once. */
export const zone_ring = (zx: number, zz: number, radius: number): readonly Readonly<{ zx: number; zz: number }>[] => {
  if (radius === 0) return [{ zx, zz }]
  const width = 2 * radius
  return Array.from({ length: 4 * width }, (_, index) => {
    const offset = (index % width) - radius
    const [dx, dz] = [
      [offset, -radius],
      [radius, offset],
      [-offset, radius],
      [-radius, -offset],
    ][Math.floor(index / width)]!
    return { zx: zx + dx!, zz: zz + dz! }
  })
}

/** Expand nearby zone rings, never generate a population or scan beyond the finite world. */
export const next_resource_zone = (
  context: RouteContext,
  eligible: typeof zone_resource_eligible = zone_resource_eligible
): AutomationTarget | null => {
  const { zx, zz } = zone_of(context.x, context.z)
  const count = Math.ceil(world_size / ZONE_SIZE)
  for (let radius = 0; radius < count; radius += 1) {
    const [nearest] = zone_ring(zx, zz, radius)
      .flatMap((zone) => candidate_zone(context, zone.zx, zone.zz, eligible) ?? [])
      .toSorted(
        (a, b) =>
          Math.hypot(a.x - context.x, a.z - context.z) - Math.hypot(b.x - context.x, b.z - context.z) ||
          a.key.localeCompare(b.key)
      )
    if (nearest) return nearest
  }
  return null
}

export const gathering_resources = (world: string | null): readonly WorldResource[] =>
  content_catalog.world(world ?? '')?.resources ?? []
