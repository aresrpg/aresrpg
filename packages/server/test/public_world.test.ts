// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { EventEmitter } from 'node:events'

import { expect, test } from 'bun:test'

import { create_public_world } from '../src/public_world.ts'

import { flush } from './helpers/world_wire.ts'

const fixture = (read: (...args: any[]) => Promise<any[]>) => {
  const emitter = new EventEmitter()
  emitter.setMaxListeners(0)
  const subscriptions: string[] = []
  const releases: string[] = []
  const bus = {
    emitter,
    subscribe: async (key: string) => {
      subscriptions.push(key)
    },
    unsubscribe: async (key: string) => {
      releases.push(key)
    },
  }
  const world = create_public_world({ read } as never, bus)
  return { world, emitter, subscriptions, releases }
}
const changed = { type: 'ItemEquipped', data: { character: 'c', slot: 'hat' } }

test('100 equipment observers share hydration and dispose the final subscription', async () => {
  let reads = 0
  const { world, subscriptions, releases } = fixture(async () => {
    reads++
    return [{ slot: 'hat', item_type: 'mokan' }]
  })
  const values: unknown[] = []
  const stops = Array.from({ length: 100 }, () =>
    world.equipment.watch(
      'c',
      (value) => values.push(value),
      () => {}
    )
  )
  await flush()
  expect(reads).toBe(1)
  expect(values).toHaveLength(100)
  expect(subscriptions).toEqual(['evt:character:c'])
  stops.slice(0, 99).forEach((stop) => stop())
  expect(world.equipment.get('c')?.hat).toBe('mokan')
  stops[99]!()
  await flush()
  expect(world.equipment.get('c')).toBeUndefined()
  expect(releases).toEqual(['evt:character:c'])
})

test('an invalidation during hydration discards the older result and coalesces the reread', async () => {
  const pending = Promise.withResolvers<any[]>()
  let reads = 0
  const { world, emitter } = fixture(async () => (++reads === 1 ? pending.promise : []))
  const values: unknown[] = []
  const stop = world.equipment.watch(
    'c',
    (value) => values.push(value.hat),
    () => {}
  )
  await flush()
  emitter.emit('evt:character:c', changed)
  emitter.emit('evt:character:c', changed)
  pending.resolve([{ slot: 'hat', item_type: 'stale' }])
  await flush()
  expect(reads).toBe(2)
  expect(values).toEqual([null])
  stop()
})

test('a disposed read cannot publish into a reacquired identity', async () => {
  const pending = Promise.withResolvers<any[]>()
  let reads = 0
  const { world } = fixture(async () => (++reads === 1 ? pending.promise : []))
  const values: unknown[] = []
  const stop = world.equipment.watch(
    'c',
    (value) => values.push(value.hat),
    () => {}
  )
  await flush()
  stop()
  const stop_next = world.equipment.watch(
    'c',
    (value) => values.push(value.hat),
    () => {}
  )
  await flush()
  pending.resolve([{ slot: 'hat', item_type: 'stale' }])
  await flush()
  expect(values).toEqual([null])
  stop_next()
})

test('failed hydration reports failure and a later invalidation recovers', async () => {
  let reads = 0
  const { world, emitter } = fixture(async () => {
    if (++reads === 1) throw new Error('unavailable')
    return []
  })
  const errors: unknown[] = []
  const values: unknown[] = []
  const stop = world.equipment.watch(
    'c',
    (value) => values.push(value.hat),
    (error) => errors.push(error)
  )
  await flush()
  expect(errors).toHaveLength(1)
  expect(values).toEqual([])
  emitter.emit('evt:character:c', changed)
  await flush()
  expect(values).toEqual([null])
  stop()
})

test('an invalidation queued behind a failed read is not lost', async () => {
  const pending = Promise.withResolvers<any[]>()
  let reads = 0
  const { world, emitter } = fixture(async () => (++reads === 1 ? pending.promise : []))
  const values: unknown[] = []
  const stop = world.equipment.watch(
    'c',
    (value) => values.push(value.hat),
    () => {}
  )
  await flush()
  emitter.emit('evt:character:c', changed)
  pending.reject(new Error('stale read failed'))
  await flush()
  expect(values).toEqual([null])
  expect(reads).toBe(2)
  stop()
})

test('zone observers share the indexed row and retain population across consumption updates', async () => {
  let reads = 0
  let seed = '7'
  const { world, emitter } = fixture(async () => {
    reads++
    return [{ zone: { properties: { world: 'nauvis', zx: 97, zz: 97, seed, mob_taken: '0', res_taken: [] } } }]
  })
  const values: any[] = []
  const stops = Array.from({ length: 20 }, () =>
    world.zones.watch(
      'nauvis:97:97',
      (value) => values.push(value),
      () => {}
    )
  )
  await flush()
  expect(reads).toBe(1)
  const population = values.at(-1).spawns
  expect(population.mobs.length).toBeGreaterThan(0)
  emitter.emit('evt:zone:nauvis:97:97', { type: 'ResourceGathered', data: {} })
  await flush()
  expect(reads).toBe(2)
  expect(values.at(-1).spawns).toBe(population)
  seed = '8'
  emitter.emit('evt:zone:nauvis:97:97', { type: 'ZoneSearched', data: {} })
  await flush()
  expect(values.at(-1).spawns).not.toBe(population)
  stops.forEach((stop) => stop())
})
