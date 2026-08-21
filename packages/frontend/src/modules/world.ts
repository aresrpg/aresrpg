// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The world's server-streamed surroundings: searched-zone rows and nearby players' live
// positions. One reducer folds the packets; the compass and minimap render this slice.

import { chain_to_client_coordinate } from '@aresrpg/immutable'
import type { FightRow, MobGroupRow, PresenceRow, ResourcePackRow, ServerPacket, ZoneRow } from '@aresrpg/protocol'

import type { AppInput, AppModule, AppState } from '../store.ts'

export type WorldState = Readonly<{
  /** searched zones by `world:zx:zz` — presence of a row means DISCOVERED (seed drawn) */
  zones: Readonly<Record<string, ZoneRow>>
  /** nearby players by character id — live positions ride packet/player_moved */
  players: Readonly<Record<string, PresenceRow>>
  /** tracked zones' live populations by `world:zx:zz` — server-derived (zone_math twin) */
  spawns: Readonly<Record<string, Readonly<{ mobs: readonly MobGroupRow[]; resources: readonly ResourcePackRow[] }>>>
  /** live fights in the tracked zones by fight id — the sword markers render this slice */
  fights: Readonly<Record<string, FightRow>>
  /** the right-clicked nearby player — the context menu renders while this holds a target */
  player_menu: PlayerMenu | null
}>

/** WHERE the menu was opened from decides what it may offer: a duel needs the two characters
 *  standing together (the chain proves the walk to the fight cell), and a name clicked in the
 *  chat log proves nothing about distance. Only the menu opened ON a body is a duel door. */
export type PlayerMenu = Readonly<{
  character_id: string
  x: number
  y: number
  source: 'body' | 'chat'
}>

export type WorldInput =
  | Readonly<{ type: 'server/packet'; packet: Readonly<ServerPacket> }>
  | Readonly<{ type: 'world/player_menu'; menu: PlayerMenu | null }>

export const zone_key = (world: string, zx: number, zz: number): string => `${world}:${zx}:${zz}`

/** A world spawn the HUD can point at — CLIENT-space x/z. */
export type SpawnMarker = Readonly<{
  kind: 'mob' | 'resource'
  spawn_id: string
  x: number
  z: number
  zx: number
  zz: number
  size?: number
  job?: string
  tier?: number
}>

/** Mob/resource spawn markers of the tracked zones, in CLIENT space — folded straight from the
 *  server's packet/zone_spawns (the zone_math twin runs server-side, never here). */
export const spawn_markers = (world: WorldState): readonly SpawnMarker[] =>
  Object.entries(world.spawns).flatMap(([key, population]) => {
    const [, zx = '0', zz = '0'] = key.split(':')
    return [
      ...population.mobs.map((group) => ({
        kind: 'mob' as const,
        spawn_id: `${key}:m${group.index}`,
        x: chain_to_client_coordinate(group.x),
        z: chain_to_client_coordinate(group.z),
        zx: Number(zx),
        zz: Number(zz),
        size: group.members.length,
      })),
      ...population.resources.map((pack) => ({
        kind: 'resource' as const,
        spawn_id: `${key}:r${pack.index}`,
        x: chain_to_client_coordinate(pack.x),
        z: chain_to_client_coordinate(pack.z),
        zx: Number(zx),
        zz: Number(zz),
        job: pack.job,
        tier: pack.tier,
      })),
    ]
  })

export const initial_world_state = (): WorldState =>
  Object.freeze({ zones: {}, players: {}, spawns: {}, fights: {}, player_menu: null })

const with_world = (state: AppState, world: WorldState): AppState => Object.freeze({ ...state, world })

const fold_packet = (world: WorldState, packet: Readonly<ServerPacket>): WorldState => {
  if (packet.type === 'packet/zones') {
    const zones = { ...world.zones }
    for (const zone of packet.zones) zones[zone_key(zone.world, zone.zx, zone.zz)] = zone
    return Object.freeze({ ...world, zones: Object.freeze(zones) })
  }
  if (packet.type === 'packet/zone_searched') {
    const key = zone_key(packet.world, packet.zx, packet.zz)
    const known = world.zones[key]
    const row: ZoneRow = {
      world: packet.world,
      zx: packet.zx,
      zz: packet.zz,
      seed: packet.seed,
      searched_at_ms: Date.now(),
      mob_taken: known?.mob_taken ?? '0',
      res_taken: known?.res_taken ?? [],
    }
    return Object.freeze({ ...world, zones: Object.freeze({ ...world.zones, [key]: row }) })
  }
  if (packet.type === 'packet/zone_spawns') {
    const key = zone_key(packet.world, packet.zx, packet.zz)
    return Object.freeze({
      ...world,
      spawns: Object.freeze({
        ...world.spawns,
        [key]: Object.freeze({ mobs: Object.freeze(packet.mobs), resources: Object.freeze(packet.resources) }),
      }),
    })
  }
  if (packet.type === 'packet/fights') {
    // whole-set replace: the snapshot IS the tracked zones' truth (ended fights never ride it)
    const fights: Record<string, FightRow> = {}
    for (const fight of packet.fights) fights[fight.id] = fight
    return Object.freeze({ ...world, fights: Object.freeze(fights) })
  }
  if (packet.type === 'packet/fight_created')
    // the projected row lands whole — this fold never fills a field the wire did not carry
    return Object.freeze({
      ...world,
      fights: Object.freeze({ ...world.fights, [packet.fight.id]: packet.fight }),
    })
  if (packet.type === 'packet/fight_phase') {
    const known = world.fights[packet.fight]
    if (!known) return world
    if (packet.phase === 'ended') {
      const fights = { ...world.fights }
      delete fights[packet.fight]
      return Object.freeze({ ...world, fights: Object.freeze(fights) })
    }
    return Object.freeze({
      ...world,
      fights: Object.freeze({ ...world.fights, [packet.fight]: Object.freeze({ ...known, phase: packet.phase }) }),
    })
  }
  if (packet.type === 'packet/player_appeared')
    return Object.freeze({
      ...world,
      players: Object.freeze({ ...world.players, [packet.player.character_id]: packet.player }),
    })
  if (packet.type === 'packet/player_moved') {
    const known = world.players[packet.character_id]
    if (!known) return world
    return Object.freeze({
      ...world,
      players: Object.freeze({
        ...world.players,
        [packet.character_id]: Object.freeze({
          ...known,
          x: packet.x,
          y: packet.y,
          z: packet.z,
          riding: packet.riding,
        }),
      }),
    })
  }
  if (packet.type === 'packet/player_equipment') {
    const known = world.players[packet.character_id]
    if (!known) return world
    return Object.freeze({
      ...world,
      players: Object.freeze({
        ...world.players,
        [packet.character_id]: Object.freeze({ ...known, [packet.slot]: packet.item_type }),
      }),
    })
  }
  if (packet.type === 'packet/player_left') {
    if (!(packet.character_id in world.players)) return world
    const players = { ...world.players }
    delete players[packet.character_id]
    return Object.freeze({
      ...world,
      players: Object.freeze(players),
      // a vanished target takes its menu with it
      player_menu: world.player_menu?.character_id === packet.character_id ? null : world.player_menu,
    })
  }
  return world
}

const reduce = (state: AppState, input: AppInput): AppState => {
  if (input.type === 'auth/disconnected' || input.type === 'auth/rejected')
    return with_world(state, initial_world_state())
  if (input.type === 'world/player_menu')
    return with_world(state, Object.freeze({ ...state.world, player_menu: input.menu }))
  if (input.type !== 'server/packet') return state
  // a re-embody starts a fresh surrounding — the server re-pushes the load snapshot
  if (input.packet.type === 'packet/characters') return state
  const next = fold_packet(state.world, input.packet)
  return next === state.world ? state : with_world(state, next)
}

// the no-op observe keeps the MODULES union uniform (chat.ts precedent)
export default Object.freeze({ name: 'world', reduce, observe: () => {} }) satisfies AppModule
