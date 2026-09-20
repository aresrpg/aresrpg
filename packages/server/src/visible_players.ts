// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One connection's interest/presentation state; indexed equipment belongs to public_world.
import { VISIBLE_SLOTS, zone_of, type PresenceRow, type PlayerPosition } from '@aresrpg/protocol'

import type { PlayerContext } from './player.ts'
import { mesh, movement_listener_channel, type MeshFact } from './protocol.ts'
import logger from './logger.ts'

const log = logger(import.meta)
const VISIBLE_PLAYERS_CAP = 100
const FAR_PLAYER_BLOCKS = 100
const FAR_MOVE_INTERVAL = 4
type RemoteFact = Extract<MeshFact, { kind: 'appear' | 'move' | 'leave' }>
type VisiblePlayer = {
  player: PresenceRow
  position: PlayerPosition
  presented: boolean
  skipped: number
  riding: boolean
  stop_move: () => void
  stop: () => void
}

const position_of = (
  world: string,
  { character_id, x, y, z, riding }: Omit<PlayerPosition, 'world'>
): PlayerPosition => ({ world, character_id, x, y, z, riding })

export const create_visible_players = ({
  address,
  signal,
  send,
  send_position,
  public_world,
  pubsub,
  get_state,
  drop,
}: Pick<
  PlayerContext,
  'address' | 'signal' | 'send' | 'send_position' | 'public_world' | 'pubsub' | 'get_state' | 'drop'
>) => {
  const visible = new Map<string, VisiblePlayer>()
  const remove = (character_id: string): void => {
    const row = visible.get(character_id)
    if (!row) return
    visible.delete(character_id)
    row.stop_move()
    row.stop()
    send({ type: 'packet/player_left', character_id })
  }
  const hydrate = (row: VisiblePlayer): (() => void) => {
    const { character_id } = row.player
    return public_world.equipment.watch(
      character_id,
      (equipment) => {
        if (signal.aborted) return
        if (row.presented) {
          VISIBLE_SLOTS.forEach((slot) =>
            send({ type: 'packet/player_equipment', character_id, slot, item_type: equipment[slot] })
          )
        } else {
          // eslint-disable-next-line no-param-reassign -- Hydration owns this private visible-player entry.
          row.presented = true
          send({ type: 'packet/player_appeared', player: { ...row.player, ...row.position, ...equipment } })
        }
      },
      (error) => {
        log.warn({ character_id, err: error }, 'visible equipment refresh failed')
        drop('SNAPSHOT_FAILED')
      }
    )
  }
  const appear = (world: string, fact: Extract<RemoteFact, { kind: 'appear' }>): void => {
    if (fact.player.world !== world) return
    const { character_id } = fact.player
    const known = visible.get(character_id)
    if (!known && !get_state().friends.has(fact.address) && visible.size >= VISIBLE_PLAYERS_CAP) return
    if (known) {
      known.stop_move()
      known.player = fact.player
      known.position = position_of(world, fact.player)
      known.riding = fact.player.riding
      known.stop_move = listen(known)
      if (known.presented)
        send({
          type: 'packet/player_appeared',
          player: { ...fact.player, ...public_world.equipment.get(character_id) },
        })
      return
    }
    const row: VisiblePlayer = {
      player: fact.player,
      position: position_of(world, fact.player),
      presented: false,
      skipped: 0,
      riding: fact.player.riding,
      stop_move: () => {},
      stop: () => {},
    }
    visible.set(character_id, row)
    row.stop_move = listen(row)
    row.stop = hydrate(row)
  }
  const move = (world: string, fact: Extract<RemoteFact, { kind: 'move' }>): void => {
    const row = visible.get(fact.character_id)
    if (!row || row.position.world !== world) return
    row.position = position_of(world, fact)
    if (!row.presented) return
    const near = Object.values(get_state().characters).some(({ presence }) => {
      const dx = fact.x - presence.x
      const dz = fact.z - presence.z
      return presence.world === world && dx * dx + dz * dz <= FAR_PLAYER_BLOCKS ** 2
    })
    row.skipped = !near && row.riding === fact.riding ? row.skipped + 1 : FAR_MOVE_INTERVAL
    if (row.skipped < FAR_MOVE_INTERVAL) return
    row.skipped = 0
    row.riding = fact.riding
    send_position(row.position)
  }
  const listen = (row: VisiblePlayer): (() => void) => {
    const { world, character_id, x, z } = row.position
    const { zx, zz } = zone_of(x, z)
    const channel = movement_listener_channel(mesh.pos(world, zx, zz), character_id)
    let active = true
    const receive = (fact: Extract<RemoteFact, { kind: 'move' }>): void => {
      if (!active || signal.aborted || fact.address === address || visible.get(character_id) !== row) return
      move(world, fact)
    }
    pubsub.mesh.emitter.on(channel, receive)
    return () => {
      active = false
      pubsub.mesh.emitter.off(channel, receive)
    }
  }
  signal.addEventListener(
    'abort',
    () => {
      visible.forEach(({ stop, stop_move }) => {
        stop_move()
        stop()
      })
      visible.clear()
    },
    { once: true }
  )
  return Object.freeze({
    receive: (world: string, fact: Exclude<RemoteFact, { kind: 'move' }>): void => {
      if (fact.address === address) return
      if (fact.kind === 'appear') return appear(world, fact)
      if (visible.get(fact.character_id)?.position.world === world) remove(fact.character_id)
    },
    retain: (zones: ReadonlySet<string>): void => {
      visible.forEach(({ position }, id) => {
        const { zx, zz } = zone_of(position.x, position.z)
        if (!zones.has(`${position.world}:${zx}:${zz}`)) remove(id)
      })
    },
  })
}
