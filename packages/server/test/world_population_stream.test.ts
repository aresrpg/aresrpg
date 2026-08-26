// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { EventEmitter } from 'node:events'

import { expect, test } from 'bun:test'
import type { ServerPacket } from '@aresrpg/protocol'

import player_world from '../src/modules/player_world.ts'
import { channels } from '../src/protocol.ts'
import type { PlayerState } from '../src/player.ts'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

const tracked_state = (): PlayerState =>
  ({
    characters: {
      '0xc': {
        presence: {
          character_id: '0xc',
          owner: '0xowner',
          name: 'Nox',
          classe: 'senshi',
          sex: 'male',
          level: 1,
          color_1: 0,
          color_2: 0,
          color_3: 0,
          hat: null,
          cloak: null,
          title: null,
          pet: null,
          riding: false,
          world: 'nauvis',
          x: 50_000,
          y: 64,
          z: 50_000,
        },
        move_anchor: { x: 50_000, z: 50_000, at_ms: 0, blocks: 0 },
        party: null,
        fight: null,
        fight_seat: null,
        active_fighter: null,
        dungeon_run: null,
      },
    },
    allowed_characters: new Set(['0xc']),
    character_signatures: {},
    roster_fights: {},
    friends: new Set(),
    spectating: {},
    fight_previews: {},
    market_observation: null,
  }) as PlayerState

const empty_state = (): PlayerState =>
  ({
    ...tracked_state(),
    characters: {},
  }) as PlayerState

test('an indexed zone discovery streams its generated mob population', async () => {
  const events = new EventEmitter()
  const graph_events = new EventEmitter()
  const mesh_events = new EventEmitter()
  const sent: ServerPacket[] = []
  const controller = new AbortController()
  let zone_visible = false
  const bus = (emitter: EventEmitter) => ({
    emitter,
    subscribe: async () => {},
    unsubscribe: async () => {},
    close: () => {},
  })
  const pubsub = {
    graph: { ...bus(graph_events), indexed_checkpoint: async () => 1, sales_history: async () => [] },
    mesh: {
      ...bus(mesh_events),
      publish: async () => {},
      heartbeat: async () => {},
      cluster_online: async () => 1,
    },
  }
  const graph = {
    read: async (query: string) =>
      query.includes('MATCH (z:Zone') && zone_visible
        ? [
            {
              zone: {
                properties: {
                  world: 'nauvis',
                  zx: 97,
                  zz: 97,
                  seed: '7',
                  searched_at_ms: 1,
                  mob_taken: '0',
                  res_taken: [],
                },
              },
            },
          ]
        : [],
    close: async () => {},
  }
  const state = tracked_state()

  player_world.observe!({
    address: '0xowner',
    graph,
    pubsub,
    events,
    signal: controller.signal,
    send: (packet: ServerPacket) => sent.push(packet),
    get_state: () => state,
    dispatch: () => {},
    drop: () => {},
    channels,
  } as never)

  events.emit('STATE_UPDATED', state, empty_state())
  await flush()
  await flush()
  expect(sent.some(({ type }) => type === 'packet/zone_spawns')).toBeFalse()

  zone_visible = true
  graph_events.emit(channels.zone('nauvis', 97, 97), {
    type: 'ZoneSearched',
    data: { world: 'nauvis', zx: 97, zz: 97 },
  })
  await flush()
  await flush()

  const population = sent.find((packet) => packet.type === 'packet/zone_spawns')
  expect(population).toMatchObject({ type: 'packet/zone_spawns', world: 'nauvis', zx: 97, zz: 97 })
  if (population?.type === 'packet/zone_spawns') expect(population.mobs.length).toBeGreaterThan(0)
  controller.abort()
})
