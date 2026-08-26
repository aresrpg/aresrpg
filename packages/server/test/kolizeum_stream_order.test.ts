// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { EventEmitter } from 'node:events'

import { expect, test } from 'bun:test'
import type { ServerPacket } from '@aresrpg/protocol'

import player_kolizeum from '../src/modules/player_kolizeum.ts'
import { channels } from '../src/protocol.ts'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
const pubsub = (subscribe: () => Promise<void>) => ({
  graph: {
    emitter: new EventEmitter(),
    subscribe,
    unsubscribe: async () => {},
    close: () => {},
    indexed_checkpoint: async () => 1,
    sales_history: async () => [],
  },
  mesh: {
    emitter: new EventEmitter(),
    subscribe: async () => {},
    unsubscribe: async () => {},
    close: () => {},
    publish: async () => {},
    heartbeat: async () => {},
    cluster_online: async () => 1,
  },
})

test('the War Table subscribes before its baseline and stale reads cannot overwrite an invalidation', async () => {
  let release_subscription = (): void => {}
  const subscription = new Promise<void>((resolve) => {
    release_subscription = resolve
  })
  const bus = pubsub(() => subscription)
  const sent: ServerPacket[] = []
  const controller = new AbortController()
  let resolve_stale = (_rows: readonly unknown[]): void => {}
  let reads = 0
  const graph = {
    read: async (query: string) => {
      if (query.includes('MATCH (c:Character)')) return []
      reads += 1
      if (reads === 1)
        return new Promise<readonly unknown[]>((resolve) => {
          resolve_stale = resolve
        })
      return [
        {
          kolizeum: {
            properties: {
              id: '0xk2',
              fight_id: '0xf2',
              format: 1,
              pledge: '0',
              pot: '0',
              level_min: 1,
              level_max: 10,
              allowed: null,
            },
          },
          fight: { properties: { phase: 'placement', machine: '{"fighters":[]}' } },
        },
      ]
    },
  }
  player_kolizeum.observe!({
    pubsub: bus,
    graph,
    signal: controller.signal,
    channels,
    address: '0xme',
    send: (packet: ServerPacket) => sent.push(packet),
  } as never)

  await flush()
  expect(reads).toBe(0)
  release_subscription()
  await flush()
  expect(reads).toBe(1)
  bus.graph.emitter.emit(channels.kolizeum, { type: 'KolizeumChanged', data: {} })
  await flush()
  await flush()
  expect(sent).toEqual([
    {
      type: 'packet/kolizeums',
      lobbies: [
        {
          id: '0xk2',
          fight: '0xf2',
          creator: '',
          format: 1,
          pledge_mist: '0',
          pot_mist: '0',
          level_min: 1,
          level_max: 10,
          public: true,
          can_join: true,
          status: 'open',
          fighters: [],
        },
      ],
    },
  ])
  resolve_stale([])
  await flush()
  expect(sent).toHaveLength(1)
  controller.abort()
})
