// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The zone-spawn PROJECTIONS — pure reads over WorldState (split from modules/world.ts under
// the 600-line law): spawn identity strings, the live population of a tracked zone, and the
// HUD's client-space markers. The reducer stays in world.ts; nothing here writes.

import { chain_to_client_coordinate } from '@aresrpg/immutable'
import {
  live_mob_groups,
  live_resource_packs,
  type DungeonPortalRow,
  type MobGroupRow,
  type ResourcePackRow,
} from '@aresrpg/protocol'

import type { WorldState } from './world.ts'

/** A rendered mob group's id — the zone it belongs to plus the group's own chain index, which is
 *  also the bit it owns in `mob_taken` and the key the engage door takes. Minted and read in one
 *  place because three surfaces need the same string: the HUD marker, the engine's entity id,
 *  and the nametag that has to find its group again. */
export const mob_group_id = (key: string, seed: string, index: number): string => `${key}:s${seed}:m${index}`
export const resource_pack_id = (key: string, seed: string, index: number): string => `${key}:s${seed}:r${index}`

/** The inverse — `null` when the id is not a mob group's (a resource pack's, or anything else). */
export const parse_mob_group_id = (id: string): Readonly<{ key: string; index: number }> | null => {
  const cut = id.lastIndexOf(':m')
  const seed_cut = id.lastIndexOf(':s', cut)
  if (cut < 0 || seed_cut < 0) return null
  const index = Number(id.slice(cut + 2))
  return Number.isInteger(index) && index >= 0 ? { key: id.slice(0, seed_cut), index } : null
}

export const parse_resource_pack_id = (id: string): Readonly<{ key: string; index: number }> | null => {
  const cut = id.lastIndexOf(':r')
  const seed_cut = id.lastIndexOf(':s', cut)
  if (cut < 0 || seed_cut < 0) return null
  const index = Number(id.slice(cut + 2))
  return Number.isInteger(index) && index >= 0 ? { key: id.slice(0, seed_cut), index } : null
}

/** A world spawn the HUD can point at — CLIENT-space x/z. */
export type SpawnMarker = Readonly<{
  kind: 'mob' | 'resource'
  spawn_id: string
  x: number
  z: number
  zx: number
  zz: number
  /** mob groups only — how many stand in the pack */
  size?: number
  /** resource packs only — the authored row's identity; job, tier, protector and the rare link
   *  all hang off it in the bundled seed, which is their one home */
  item_type?: string
}>

export type DungeonPortalMarker = Readonly<{
  id: string
  world: string
  x: number
  z: number
  zx: number
  zz: number
}>

const EMPTY_POPULATION = Object.freeze({ mobs: Object.freeze([]), resources: Object.freeze([]), portal: null })

/** THE LIVE POPULATION of one tracked zone: the seed's draw crossed with the zone's own
 *  consumption. Every surface that shows a zone's contents goes through here — the HUD markers,
 *  the world's rendered mobs and nodes, the interaction targets — so none of them can disagree
 *  about whether a group is still standing. An undiscovered or unpopulated zone is honestly
 *  empty rather than absent. */
export const live_spawns = (
  world: WorldState,
  key: string
): Readonly<{
  mobs: readonly MobGroupRow[]
  resources: readonly ResourcePackRow[]
  portal: DungeonPortalRow | null
}> => {
  const population = world.spawns[key]
  const zone = world.zones[key]
  // a population with no zone row states nothing about consumption; the seed only reaches the
  // client alongside its row, so this is a torn moment, not "nothing has been taken"
  if (!population || !zone) return EMPTY_POPULATION
  return Object.freeze({
    mobs: live_mob_groups(population.mobs, zone).filter(
      ({ index }) => !(mob_group_id(key, zone.seed, index) in world.pending_engages)
    ),
    resources: live_resource_packs(population.resources, zone),
    portal: population.portal,
  })
}

/** Mob/resource spawn markers of the tracked zones, in CLIENT space — the LIVE population of
 *  each (the zone_math twin runs server-side, never here). */
export const spawn_markers = (
  world: WorldState,
  selected_world: string | null = world.tracked_world
): readonly SpawnMarker[] =>
  selected_world
    ? Object.keys(world.spawns).flatMap((key) => {
        if (!key.startsWith(`${selected_world}:`)) return []
        const population = live_spawns(world, key)
        const seed = world.zones[key]?.seed
        if (!seed) return []
        const [, zx = '0', zz = '0'] = key.split(':')
        return [
          ...population.mobs.map((group) => ({
            kind: 'mob' as const,
            spawn_id: mob_group_id(key, seed, group.index),
            x: chain_to_client_coordinate(group.x),
            z: chain_to_client_coordinate(group.z),
            zx: Number(zx),
            zz: Number(zz),
            size: group.members.length,
          })),
          ...population.resources.map((pack) => ({
            kind: 'resource' as const,
            spawn_id: resource_pack_id(key, seed, pack.index),
            x: chain_to_client_coordinate(pack.x),
            z: chain_to_client_coordinate(pack.z),
            zx: Number(zx),
            zz: Number(zz),
            item_type: pack.item_type,
          })),
        ]
      })
    : Object.freeze([])

export const dungeon_portal_markers = (
  world: WorldState,
  selected_world: string | null
): readonly DungeonPortalMarker[] =>
  selected_world
    ? Object.entries(world.spawns).flatMap(([key, population]) => {
        const seed = world.zones[key]?.seed
        if (!key.startsWith(`${selected_world}:`) || !population.portal || !seed) return []
        const [, zx = '0', zz = '0'] = key.split(':')
        return [
          Object.freeze({
            id: `dungeon:${key}:s${seed}`,
            world: selected_world,
            x: chain_to_client_coordinate(population.portal.x),
            z: chain_to_client_coordinate(population.portal.z),
            zx: Number(zx),
            zz: Number(zz),
          }),
        ]
      })
    : Object.freeze([])
