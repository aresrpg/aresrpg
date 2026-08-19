// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { EventEmitter } from 'node:events'

import { expect, test } from 'bun:test'

import { create_graph_bus, create_mesh_bus, type BusRedis } from '../src/pubsub_bus.ts'

const fake_redis = () => {
  const emitter = new EventEmitter()
  const calls: string[][] = []
  const record =
    (name: string) =>
    async (...args: unknown[]) => {
      calls.push([name, ...args.map(String)])
      return undefined as never
    }
  const redis: BusRedis = {
    on: (event, listener) => void emitter.on(event, listener as (...args: unknown[]) => void),
    subscribe: record('subscribe') as BusRedis['subscribe'],
    unsubscribe: record('unsubscribe') as BusRedis['unsubscribe'],
    publish: record('publish') as BusRedis['publish'],
    setex: record('setex') as BusRedis['setex'],
    get: async () => null,
    scan: async () => ['0', []],
    mget: async () => [],
    disconnect: () => void calls.push(['disconnect']),
  }
  return { redis, emitter, calls }
}

test('a lost graph connection fires on_lost — a server without its indexer must die', () => {
  const subscriber = fake_redis()
  const publisher = fake_redis()
  const deaths: string[] = []
  const bus = create_graph_bus({
    subscriber: subscriber.redis,
    publisher: publisher.redis,
    on_lost: (reason) => void deaths.push(reason),
  })

  subscriber.emitter.emit('end')

  expect(deaths).toEqual(['graph connection ended'])
  void bus
})

test('a deliberate close never counts as a lost connection', () => {
  const subscriber = fake_redis()
  const publisher = fake_redis()
  const deaths: string[] = []
  const bus = create_graph_bus({
    subscriber: subscriber.redis,
    publisher: publisher.redis,
    on_lost: (reason) => void deaths.push(reason),
  })

  bus.close()
  subscriber.emitter.emit('end')
  publisher.emitter.emit('end')

  expect(deaths).toEqual([])
})

test('subscriptions are refcounted — many watchers, one SUBSCRIBE, and the last unsubscribe releases the wire', async () => {
  const subscriber = fake_redis()
  const publisher = fake_redis()
  const bus = create_mesh_bus({ subscriber: subscriber.redis, publisher: publisher.redis })

  await bus.subscribe('pos:w:0:0')
  await bus.subscribe('pos:w:0:0')
  await bus.unsubscribe('pos:w:0:0')
  await bus.unsubscribe('pos:w:0:0')

  const subscribes = subscriber.calls.filter(([name]) => name === 'subscribe')
  const unsubscribes = subscriber.calls.filter(([name]) => name === 'unsubscribe')
  expect(subscribes).toHaveLength(1)
  expect(unsubscribes).toHaveLength(1)
})

test('a message fans out parsed, and the heartbeat writes the TTL presence key', async () => {
  const subscriber = fake_redis()
  const publisher = fake_redis()
  const bus = create_mesh_bus({ subscriber: subscriber.redis, publisher: publisher.redis })
  const seen: unknown[] = []
  bus.emitter.on('chat:world:w1', (payload) => void seen.push(payload))

  subscriber.emitter.emit('message', 'chat:world:w1', JSON.stringify({ text: 'yo' }))
  await bus.heartbeat('pod-1', 3)

  expect(seen).toEqual([{ text: 'yo' }])
  expect(publisher.calls).toContainEqual(['setex', 'server:pod-1', '20', '3'])
})

test('the graph bus reads the indexer checkpoint marker from ITS OWN redis', async () => {
  const subscriber = fake_redis()
  const publisher = fake_redis()
  const marked: BusRedis = { ...publisher.redis, get: async () => JSON.stringify({ sequence_number: 4242 }) }
  const bus = create_graph_bus({ subscriber: subscriber.redis, publisher: marked, on_lost: () => undefined })

  expect(await bus.indexed_checkpoint()).toBe(4242)
})
