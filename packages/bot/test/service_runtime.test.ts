// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { shutdown_service, start_service_runtime } from '../src/service_runtime.ts'

import { runtime_fixture } from './helpers/runtime_fixture.ts'
import { put } from './helpers/control_fixture.ts'

test('subscription acknowledgment precedes scheduling and readiness', async () => {
  const f = await runtime_fixture()
  let acknowledge!: () => void
  const acknowledgment = new Promise<void>((resolve) => {
    acknowledge = resolve
  })
  let ticks = 0
  let unsubscribed = false
  const starting = start_service_runtime({
    ...f.options,
    publisher: { publish: async () => 0 },
    tick_ms: 60000,
    heartbeat_ms: 60000,
    runtime: {
      ...f.runtime,
      tick: async () => {
        ticks += 1
      },
    },
    subscriber: {
      connect: async () => undefined,
      close: () => undefined,
      onclose: null,
      subscribe: async () => {
        await acknowledgment
        return 1
      },
      unsubscribe: async () => {
        unsubscribed = true
      },
    },
  })
  await Bun.sleep(1)
  expect(ticks).toBe(0)
  expect(await f.store.scan_keys('lane:', 100)).toEqual([])
  acknowledge()
  const service = await starting
  expect(ticks).toBe(1)
  expect(service.ready()).toBe(true)
  await service.stop()
  expect(service.ready()).toBe(false)
  expect(unsubscribed).toBe(true)
})

test('shutdown waits for both drains and closes Redis after unsubscribe failure', async () => {
  const events: string[] = []
  let release!: () => void
  const drain = new Promise<void>((resolve) => {
    release = resolve
  })
  const failure = new Error('fixture_unsubscribe_failure')
  const stopping = shutdown_service({
    server: {
      stop: async () => {
        await drain
        events.push('http_drained')
      },
    },
    stop: async () => {
      throw failure
    },
    redis: {
      close: () => {
        events.push('redis_closed')
      },
    },
    report_failure: (error) => {
      expect(error).toBe(failure)
      events.push('failure_reported')
    },
  })
  await Bun.sleep(1)
  expect(events).toEqual([])
  release()
  await stopping
  expect(events).toEqual(['http_drained', 'redis_closed', 'failure_reported'])
})

test('committed work wakes the scheduler without waiting for its timer and stops on disposal', async () => {
  const f = await runtime_fixture()
  const wakes: string[] = []
  const service = await start_service_runtime({
    ...f.options,
    publisher: { publish: async () => 0 },
    subscriber: {
      connect: async () => undefined,
      close: () => undefined,
      onclose: null,
      subscribe: async () => 1,
      unsubscribe: async () => undefined,
    },
    tick_ms: 60000,
    heartbeat_ms: 60000,
    runtime: {
      ...f.runtime,
      wake: async (key) => {
        wakes.push(key)
      },
    },
  })
  try {
    await expect(
      f.store.transaction(['command:rollback'], async (tx) => {
        await tx.put('command:rollback', { status: 'accepted' })
        throw new Error('rollback')
      })
    ).rejects.toThrow('rollback')
    expect(wakes).toEqual([])
    await put(f.store, 'command:first', { status: 'accepted' })
    expect(wakes).toEqual(['command:first'])
    await put(f.store, 'command:first', { status: 'executing' })
    expect(wakes).toEqual(['command:first'])
    await service.stop()
    await put(f.store, 'command:stopped', { status: 'accepted' })
    expect(wakes).toEqual(['command:first'])
  } finally {
    await service.stop()
  }
})
