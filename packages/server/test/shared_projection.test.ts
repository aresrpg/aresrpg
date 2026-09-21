// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { EventEmitter } from 'node:events'

import { expect, test } from 'bun:test'

import { shared_projection } from '../src/shared_projection.ts'

// Use a short interval while testing the same production scheduling path.
test('sampled projections coalesce bursts, deliver under sustained invalidation, and stop on last release', async () => {
  const emitter = new EventEmitter(),
    pending = Promise.withResolvers<number>()
  let reads = 0
  const seen: number[] = [],
    starts: number[] = []
  const projection = shared_projection({
    bus: { emitter, subscribe: async () => {}, unsubscribe: async () => {} },
    channel: () => 'market',
    invalidates: () => true,
    sample_interval_ms: 40,
    read: async () => {
      starts.push(performance.now())
      reads++
      return reads === 1 ? pending.promise : reads
    },
  })
  const stops = Array.from({ length: 100 }, () =>
    projection.watch(
      'all',
      (value) => seen.push(value),
      () => {}
    )
  )
  await Bun.sleep(0)
  for (let i = 0; i < 100; i++) emitter.emit('market', {})
  expect(reads).toBe(1)
  pending.resolve(1)
  await Bun.sleep(0)
  expect(seen).toHaveLength(100)
  await Bun.sleep(60)
  expect(reads).toBe(2)
  expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(35)
  emitter.emit('market', {})
  stops.forEach((stop) => stop())
  const last = reads
  await Bun.sleep(60)
  expect(reads).toBe(last)
  expect(emitter.listenerCount('market')).toBe(0)
})

test('strict projections still discard obsolete reads', async () => {
  const emitter = new EventEmitter(),
    first = Promise.withResolvers<number>()
  let reads = 0
  const seen: number[] = []
  const projection = shared_projection({
    bus: { emitter, subscribe: async () => {}, unsubscribe: async () => {} },
    channel: () => 'strict',
    invalidates: () => true,
    read: async () => (++reads === 1 ? first.promise : 2),
  })
  const stop = projection.watch(
    'one',
    (value) => seen.push(value),
    () => {}
  )
  await Bun.sleep(0)
  emitter.emit('strict', {})
  first.resolve(1)
  await Bun.sleep(0)
  expect(seen).toEqual([2])
  stop()
})

test('sampled reopen shares a pending read and preserves the sampling deadline', async () => {
  const emitter = new EventEmitter(),
    pending = Promise.withResolvers<number>()
  let reads = 0,
    subscriptions = 0
  const seen: number[] = []
  const projection = shared_projection({
    bus: {
      emitter,
      subscribe: async () => {
        subscriptions++
      },
      unsubscribe: async () => {
        subscriptions--
      },
    },
    channel: () => 'reopen',
    invalidates: () => true,
    sample_interval_ms: 100,
    read: async () => {
      reads++
      return reads === 1 ? pending.promise : reads
    },
  })
  let stop = projection.watch(
    'all',
    (value) => seen.push(value),
    () => {}
  )
  await Bun.sleep(0)
  stop()
  await Bun.sleep(0)
  expect(subscriptions).toBe(0)
  expect(emitter.listenerCount('reopen')).toBe(0)
  stop = projection.watch(
    'all',
    (value) => seen.push(value),
    () => {}
  )
  await Bun.sleep(0)
  expect(reads).toBe(1)
  pending.resolve(1)
  await Bun.sleep(0)
  expect(seen).toEqual([1])
  stop()
  await Bun.sleep(0)
  stop = projection.watch(
    'all',
    (value) => seen.push(value),
    () => {}
  )
  await Bun.sleep(0)
  expect(reads).toBe(1)
  stop()
  await Bun.sleep(120)
  expect(projection.get('all')).toBeUndefined()
  expect(reads).toBe(1)
  expect(subscriptions).toBe(0)
})

test('idle sampled reads remain shared after the cooldown until they settle', async () => {
  const emitter = new EventEmitter(),
    pending = Promise.withResolvers<number>()
  let reads = 0
  const seen: number[] = []
  const projection = shared_projection({
    bus: { emitter, subscribe: async () => {}, unsubscribe: async () => {} },
    channel: () => 'slow',
    invalidates: () => true,
    sample_interval_ms: 20,
    read: async () => (++reads === 1 ? pending.promise : reads),
  })
  const first = projection.watch(
    'all',
    () => {},
    () => {}
  )
  await Bun.sleep(0)
  first()
  await Bun.sleep(35)
  const second = projection.watch(
    'all',
    (value) => seen.push(value),
    () => {}
  )
  await Bun.sleep(0)
  expect(reads).toBe(1)
  pending.resolve(1)
  await Bun.sleep(0)
  expect(seen[0]).toBe(1)
  second()
  await Bun.sleep(30)
  expect(projection.get('all')).toBeUndefined()
})

test('close and reopen during subscription setup balances subscriptions without starting an abandoned read', async () => {
  const emitter = new EventEmitter(),
    subscribed = Promise.withResolvers<void>()
  let subscriptions = 0,
    releases = 0,
    reads = 0
  const projection = shared_projection({
    bus: {
      emitter,
      subscribe: async () => {
        if (++subscriptions === 1) await subscribed.promise
      },
      unsubscribe: async () => {
        releases++
      },
    },
    channel: () => 'setup',
    invalidates: () => true,
    sample_interval_ms: 40,
    read: async () => ++reads,
  })
  const first = projection.watch(
    'all',
    () => {},
    () => {}
  )
  await Bun.sleep(0)
  first()
  const second = projection.watch(
    'all',
    () => {},
    () => {}
  )
  subscribed.resolve()
  await Bun.sleep(0)
  expect(reads).toBe(1)
  expect(subscriptions - releases).toBe(1)
  expect(emitter.listenerCount('setup')).toBe(1)
  second()
  await Bun.sleep(60)
  expect(subscriptions).toBe(releases)
  expect(emitter.listenerCount('setup')).toBe(0)
})
