// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { world_size } from '@aresrpg/immutable'
import { ZONE_SIZE, ZONE_RESEARCH_TTL_MS, live_resource_packs, live_mob_groups } from '@aresrpg/protocol'

import { area_contains, assert_area_position, WORLD_AREA_SCHEMA, type WorldArea } from './target_constraints.ts'
import { zone_key } from './actor_world.ts'
import { gameplay_observed_ms, owned_character, type GameplayContext } from './gameplay_context.ts'
import { coordinate, identifier, nonempty, object_schema } from './gameplay_schema.ts'
import type { SelectedAction } from './behavior_targets.ts'

export type WorldRegion = Readonly<{ min_zx: number; max_zx: number; min_zz: number; max_zz: number }>
export type DiscoverAction = Readonly<{
  type: 'discover'
  character_id: string
  world: string
  area?: WorldArea
}> &
  (
    | Readonly<{ region: WorldRegion; order: 'nearest' }>
    | Readonly<{ region?: never; area: WorldArea; order: 'nearest' }>
    | Readonly<{ order: 'onward' }>
  )
export type WorldSelection =
  | Readonly<{ status: 'action'; action: SelectedAction }>
  | Readonly<{ status: 'success' }>
  | Readonly<{ status: 'waiting'; code: string; wake_at?: number }>
  | Readonly<{ status: 'failure'; code: string }>
export const WORLD_REGION_SCHEMA = object_schema({
  min_zx: coordinate,
  max_zx: coordinate,
  min_zz: coordinate,
  max_zz: coordinate,
})
const discovery_properties = { type: { const: 'discover' }, character_id: identifier, world: nonempty } as const
export const WORLD_ACTION_SCHEMAS = [
  {
    ...object_schema({
      ...discovery_properties,
      region: WORLD_REGION_SCHEMA,
      order: { const: 'nearest' },
      area: WORLD_AREA_SCHEMA,
    }),
    required: [...Object.keys(discovery_properties), 'region', 'order'],
  },
  object_schema({ ...discovery_properties, order: { const: 'nearest' }, area: WORLD_AREA_SCHEMA }),
  object_schema({ ...discovery_properties, order: { const: 'onward' } }),
] as const

/** Adjacent Hamiltonian cycle of the world's even-sized zone grid; the first column closes the route.
 * Position is the only cursor. Refresh receipts move the authoritative checkpoint into the next zone. */
export const onward_zone = (zx: number, zz: number) => {
  const side = Math.ceil(world_size / ZONE_SIZE)
  if (zx === 0) return zz === 0 ? { zx: 1, zz: 0 } : { zx: 0, zz: zz - 1 }
  if (zz % 2 === 0) return zx < side - 1 ? { zx: zx + 1, zz } : { zx, zz: zz + 1 }
  return zx > 1 ? { zx: zx - 1, zz } : { zx: zz < side - 1 ? 1 : 0, zz: Math.min(side - 1, zz + 1) }
}
const discover_target = (action: DiscoverAction, x: number, z: number): WorldSelection => ({
  status: 'action',
  action: {
    kind: 'world_search',
    payload: {
      character_id: action.character_id,
      world: action.world,
      x,
      z,
      ...(action.area ? { area: action.area } : {}),
    },
  },
})
const select_onward = (action: DiscoverAction, context: GameplayContext): WorldSelection => {
  const character = owned_character(context, action.character_id)
  const { zx, zz } = onward_zone(Math.floor(character.x! / ZONE_SIZE), Math.floor(character.z! / ZONE_SIZE))
  const tracked = context.snapshot.tracked_zones[character.id]
  if (!tracked?.zones.some((zone) => zone.zx === zx && zone.zz === zz))
    return { status: 'waiting', code: 'needs_resync' }
  return discover_target(
    action,
    Math.min(world_size - 1, (zx + 0.5) * ZONE_SIZE),
    Math.min(world_size - 1, (zz + 0.5) * ZONE_SIZE)
  )
}

const within = ({ zx, zz }: Readonly<{ zx: number; zz: number }>, region: WorldRegion) =>
  zx >= region.min_zx && zx <= region.max_zx && zz >= region.min_zz && zz <= region.max_zz
const region_valid = (region: WorldRegion) => region.min_zx <= region.max_zx && region.min_zz <= region.max_zz

/** Missing tracked rows are undiscovered; present rows retain the canonical refresh deadline. */
export const select_discovery = (action: DiscoverAction, context: GameplayContext): WorldSelection => {
  const character = owned_character(context, action.character_id)
  const window = context.snapshot.tracked_zones[character.id]
  if (![window?.world === action.world, character.world === action.world].every(Boolean))
    return { status: 'waiting', code: 'needs_resync' }
  assert_area_position(action.area, character.world!, character.x!, character.z!)
  if (action.order === 'onward') return select_onward(action, context)
  const last_zone = Math.ceil(world_size / ZONE_SIZE) - 1
  const region = action.region ?? { min_zx: 0, max_zx: last_zone, min_zz: 0, max_zz: last_zone }
  if (!region_valid(region)) return { status: 'failure', code: 'invalid_region' }
  const chain_ms = Number(gameplay_observed_ms(context))
  const candidates = window!.zones
    .filter((zone) => within(zone, region))
    .map(({ zx, zz }) => {
      const row = context.snapshot.zones[zone_key(action.world, zx, zz)]
      const x = Math.min(world_size - 1, zx * ZONE_SIZE + ZONE_SIZE / 2)
      const z = Math.min(world_size - 1, zz * ZONE_SIZE + ZONE_SIZE / 2)
      return {
        x,
        z,
        ready_at: row ? row.zone.searched_at_ms + ZONE_RESEARCH_TTL_MS : 0,
        distance: Math.hypot(x - character.x!, z - character.z!),
      }
    })
    .filter(({ x, z }) => !action.area || area_contains(action.area, action.world, x, z))
  if (!candidates.length) return { status: 'failure', code: 'region_outside_tracked_window' }
  const [target] = candidates
    .filter(({ ready_at }) => ready_at <= chain_ms)
    .toSorted((a, b) => a.distance - b.distance || a.x - b.x || a.z - b.z)
  if (!target)
    return {
      status: 'waiting',
      code: 'zone_refresh_pending',
      wake_at: context.now + Math.min(...candidates.map(({ ready_at }) => ready_at - chain_ms)),
    }
  return discover_target(action, target.x, target.z)
}

export type WorldAvailability = Readonly<{
  character_id: string
  world: string
  region: WorldRegion
}> &
  (
    | Readonly<{ type: 'resource_available'; item_type: string }>
    | Readonly<{ type: 'mob_available'; mob_types: readonly string[] }>
  )
/** False requires every tracked zone in the requested region to have a population snapshot. */
export const world_available = (fact: WorldAvailability, context: GameplayContext): boolean | null => {
  const window = context.snapshot.tracked_zones[fact.character_id]
  if (!window || window.world !== fact.world || !region_valid(fact.region)) return null
  const zones = window.zones.filter((zone) => within(zone, fact.region))
  if (!zones.length) return null
  const rows = zones.map(({ zx, zz }) => context.snapshot.zones[zone_key(fact.world, zx, zz)])
  const found = rows.some(
    (row) =>
      row?.spawns &&
      (fact.type === 'resource_available'
        ? live_resource_packs(row.spawns.resources, row.zone).some(({ item_type }) => item_type === fact.item_type)
        : live_mob_groups(row.spawns.mobs, row.zone).some(
            ({ members }) => members.length > 0 && members.every(({ mob_type }) => fact.mob_types.includes(mob_type))
          ))
  )
  return found ? true : rows.some((row) => !row?.spawns) ? null : false
}
