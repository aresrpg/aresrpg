// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { EventEmitter } from 'node:events'

import { expect, test } from 'bun:test'
import type { ServerPacket } from '@aresrpg/protocol'

import player_dungeon from '../src/modules/player_dungeon.ts'
import player_party from '../src/modules/player_party.ts'
import player_fight from '../src/modules/player_fight.ts'
import { channels } from '../src/protocol.ts'
import type { PlayerState } from '../src/player.ts'

const empty_state = (): PlayerState =>
  ({
    characters: {},
    allowed_characters: new Set(),
    character_signatures: {},
    roster_fights: {},
    friends: new Set(),
    spectating: {},
    fight_previews: {},
    market_observation: null,
  }) as unknown as PlayerState

const tracked_state = ({ dungeon = false, party = null as string | null } = {}): PlayerState =>
  ({
    ...empty_state(),
    characters: {
      '0xc1': {
        presence: { character_id: '0xc1', name: 'Nox', world: 'nauvis' },
        party,
        fight: null,
        fight_seat: null,
        active_fighter: null,
        dungeon_run: dungeon ? { dungeon: 'tangled_aftermath', room: 1 } : null,
      },
    },
  }) as unknown as PlayerState

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

const bus_pair = (subscribe: (channel: string) => Promise<void>) => {
  const graph_emitter = new EventEmitter()
  const mesh_emitter = new EventEmitter()
  const common = (emitter: EventEmitter) => ({
    emitter,
    subscribe,
    unsubscribe: async () => {},
    close: () => {},
  })
  return {
    graph: { ...common(graph_emitter), indexed_checkpoint: async () => 1, sales_history: async () => [] },
    mesh: {
      ...common(mesh_emitter),
      publish: async () => {},
      heartbeat: async () => {},
      cluster_online: async () => 1,
    },
  }
}

test('a dungeon lobby snapshots only after its scoped subscription is ready', async () => {
  let release_subscription = (): void => {}
  const subscription = new Promise<void>((resolve) => {
    release_subscription = resolve
  })
  const pubsub = bus_pair(async (channel) => (channel.startsWith('evt:dungeon:') ? subscription : undefined))
  const sent: ServerPacket[] = []
  const events = new EventEmitter()
  const controller = new AbortController()
  const current = tracked_state({ dungeon: true })
  const graph = {
    read: async (query: string) =>
      query.includes('RETURN c.id') ? [{ character_id: '0xc1', name: 'Nox', level: 12, room: 1 }] : [],
    close: async () => {},
  }
  player_dungeon.observe!({
    pubsub,
    graph,
    events,
    signal: controller.signal,
    channels,
    send: (packet: ServerPacket) => sent.push(packet),
    get_state: () => current,
  } as never)

  events.emit('STATE_UPDATED', current, empty_state())
  await flush()
  expect(sent).toEqual([])

  release_subscription()
  await flush()
  await flush()
  expect(sent.map(({ type }) => type)).toEqual(['packet/dungeon_lobby'])
  controller.abort()
})

test('a stale dungeon baseline cannot overwrite a newer lobby invalidation', async () => {
  const pubsub = bus_pair(async () => {})
  const sent: ServerPacket[] = []
  const events = new EventEmitter()
  const controller = new AbortController()
  const current = tracked_state({ dungeon: true })
  let resolve_stale = (_rows: readonly unknown[]): void => {}
  let fight_reads = 0
  const graph = {
    read: async (query: string) => {
      if (query.includes('RETURN c.id')) return [{ character_id: '0xc1', name: 'Nox', level: 12, room: 1 }]
      fight_reads += 1
      if (fight_reads === 1)
        return new Promise<readonly unknown[]>((resolve) => {
          resolve_stale = resolve
        })
      return [
        {
          fight: {
            properties: {
              id: '0xf1',
              dungeon_room: 1,
              phase: 'placement',
              access_a: 0,
              opener_a: '0xc1',
            },
          },
          players: [{ character_id: '0xc1', name: 'Nox', level: 12, room: 1 }],
        },
      ]
    },
    close: async () => {},
  }
  player_dungeon.observe!({
    pubsub,
    graph,
    events,
    signal: controller.signal,
    channels,
    send: (packet: ServerPacket) => sent.push(packet),
    get_state: () => current,
  } as never)

  events.emit('STATE_UPDATED', current, empty_state())
  await flush()
  pubsub.graph.emitter.emit('evt:dungeon:tangled_aftermath', {
    type: 'DungeonLobbyChanged',
    data: { world: 'nauvis', x: 1649, z: 2490 },
  })
  await flush()
  await flush()
  resolve_stale([])
  await flush()

  const lobbies = sent.flatMap((packet) => (packet.type === 'packet/dungeon_lobby' ? [packet.lobby] : []))
  expect(lobbies).toHaveLength(1)
  expect(lobbies[0]?.fights.map(({ id }) => id)).toEqual(['0xf1'])
  controller.abort()
})

test('party membership events refresh the complete party snapshot', async () => {
  const pubsub = bus_pair(async () => {})
  const sent: ServerPacket[] = []
  const events = new EventEmitter()
  const controller = new AbortController()
  const current = tracked_state({ party: '0xp1' })
  let members = [{ order: 0, id: '0xc1', name: 'Nox' }]
  const graph = {
    read: async () => [
      {
        party: { properties: { id: '0xp1' } },
        members: members.map(({ order, id, name }) => ({
          order,
          character: { properties: { id, name } },
        })),
        invited: [],
      },
    ],
    close: async () => {},
  }
  player_party.observe!({
    pubsub,
    graph,
    events,
    signal: controller.signal,
    channels,
    address: '0xme',
    send: (packet: ServerPacket) => sent.push(packet),
    get_state: () => current,
  } as never)

  events.emit('STATE_UPDATED', current, empty_state())
  await flush()
  await flush()
  members = [members[0]!, { order: 1, id: '0xc2', name: 'Mina' }]
  pubsub.graph.emitter.emit('evt:party:0xp1', {
    type: 'PartyJoined',
    data: { party: '0xp1', character: '0xc2' },
  })
  await flush()
  await flush()

  const snapshots = sent.filter((packet) => packet.type === 'packet/party')
  expect(snapshots.at(-1)).toMatchObject({
    type: 'packet/party',
    party: { members: [{ character_id: '0xc1' }, { character_id: '0xc2' }] },
  })
  controller.abort()
})

test('spectating and temporary previews are independent per-character environments', () => {
  const base = empty_state()
  const first = player_fight.reduce!(base, {
    type: 'action/spectate',
    character_id: '0xc1',
    fight: '0xf1',
  })
  const second = player_fight.reduce!(first, {
    type: 'action/spectate',
    character_id: '0xc2',
    fight: '0xf2',
  })
  const preview = player_fight.reduce!(second, {
    type: 'action/fight_preview',
    character_id: '0xc2',
    fight: '0xf3',
  })
  expect(preview.spectating).toEqual({ '0xc1': '0xf1', '0xc2': '0xf2' })
  expect(preview.fight_previews).toEqual({ '0xc2': '0xf3' })
})
