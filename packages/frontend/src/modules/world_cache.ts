// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One union of world facts, projected through the selected character's tracked window.

import { zone_of, type ServerPacket } from '@aresrpg/protocol'

import type { WorldState } from './world.ts'

const key_of = (world: string, zx: number, zz: number): string => `${world}:${zx}:${zz}`

const prune_world_union = (world: WorldState): WorldState => {
  const wanted = new Set(
    Object.values(world.windows).flatMap(({ world: name, zones }) => zones.map(({ zx, zz }) => key_of(name, zx, zz)))
  )
  const keep = <T>(rows: Readonly<Record<string, T>>): Readonly<Record<string, T>> =>
    Object.freeze(Object.fromEntries(Object.entries(rows).filter(([key]) => wanted.has(key))))
  return Object.freeze({
    ...world,
    all_zones: keep(world.all_zones),
    all_spawns: keep(world.all_spawns),
    all_fights: Object.freeze(
      Object.fromEntries(
        Object.entries(world.all_fights).filter(([, fight]) => {
          const at = zone_of(fight.x, fight.z)
          return wanted.has(key_of(fight.world, at.zx, at.zz))
        })
      )
    ),
    all_players: Object.freeze(
      Object.fromEntries(
        Object.entries(world.all_players).filter(([, player]) => {
          const at = zone_of(player.x, player.z)
          return wanted.has(key_of(player.world, at.zx, at.zz))
        })
      )
    ),
  })
}

export const retain_world_characters = (
  world: WorldState,
  character_ids: ReadonlySet<string>,
  selected_character_id: string | null
): WorldState => {
  const windows = Object.freeze(
    Object.fromEntries(Object.entries(world.windows).filter(([character_id]) => character_ids.has(character_id)))
  )
  return project_world_window(prune_world_union(Object.freeze({ ...world, windows })), selected_character_id)
}

export const project_world_window = (world: WorldState, character_id: string | null): WorldState => {
  const window = character_id ? world.windows[character_id] : undefined
  if (!window)
    return Object.freeze({
      ...world,
      tracked_world: null,
      zones: {},
      players: {},
      spawns: {},
      fights: {},
      pending_engages: {},
      player_menu: null,
    })
  const wanted = new Set(window.zones.map(({ zx, zz }) => key_of(window.world, zx, zz)))
  const keep = <T>(rows: Readonly<Record<string, T>>): Readonly<Record<string, T>> =>
    Object.freeze(Object.fromEntries(Object.entries(rows).filter(([key]) => wanted.has(key))))
  const players = Object.freeze(
    Object.fromEntries(
      Object.entries(world.all_players).filter(([, player]) => {
        if (player.world !== window.world) return false
        const at = zone_of(player.x, player.z)
        return wanted.has(key_of(player.world, at.zx, at.zz))
      })
    )
  )
  const fights = Object.freeze(
    Object.fromEntries(
      Object.entries(world.all_fights).filter(([, fight]) => {
        if (fight.world !== window.world) return false
        const at = zone_of(fight.x, fight.z)
        return wanted.has(key_of(fight.world, at.zx, at.zz))
      })
    )
  )
  return Object.freeze({
    ...world,
    tracked_world: window.world,
    zones: keep(world.all_zones),
    players,
    spawns: keep(world.all_spawns),
    fights,
    pending_engages: Object.freeze(
      Object.fromEntries(Object.entries(world.pending_engages).filter(([, pending]) => wanted.has(pending.key)))
    ),
    player_menu: world.player_menu && players[world.player_menu.character_id] ? world.player_menu : null,
  })
}

export const fold_cached_world = (
  world: WorldState,
  packet: Readonly<ServerPacket>,
  character_id: string | null,
  fold_union: (world: WorldState, packet: Readonly<ServerPacket>) => WorldState
): WorldState => {
  if (packet.type === 'packet/tracked_zones')
    return project_world_window(
      prune_world_union(
        Object.freeze({
          ...world,
          windows: Object.freeze({
            ...world.windows,
            [packet.character_id]: Object.freeze({ world: packet.world, zones: Object.freeze(packet.zones) }),
          }),
        })
      ),
      character_id
    )
  const union = Object.freeze({
    ...world,
    zones: world.all_zones,
    players: world.all_players,
    spawns: world.all_spawns,
    fights: world.all_fights,
  })
  const folded = fold_union(union, packet)
  if (folded === union) return world
  return project_world_window(
    Object.freeze({
      ...folded,
      all_zones: folded.zones,
      all_players: folded.players,
      all_spawns: folded.spawns,
      all_fights: folded.fights,
    }),
    character_id
  )
}
