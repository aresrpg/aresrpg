// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { coalesced_reader, latest_reader } from '../src/latest_read.ts'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((accept, refuse) => {
    resolve = accept
    reject = refuse
  })
  return { promise, resolve, reject }
}
const fixture = () => {
  const controller = new AbortController()
  const reads: ReturnType<typeof deferred<number>>[] = []
  const delivered: number[] = []
  const refresh = coalesced_reader(
    () => {
      const next = deferred<number>()
      reads.push(next)
      return next.promise
    },
    (value) => {
      delivered.push(value)
    },
    controller.signal
  )
  return { controller, reads, delivered, refresh }
}
const flush = async () => {
  for (let index = 0; index < 10; index++) await Promise.resolve()
}

test('a burst shares one pending rerun and delivers only its fresh result', async () => {
  const { refresh, reads, delivered } = fixture()
  const first = refresh()
  await flush()
  const pending = Array.from({ length: 50 }, refresh)
  expect(new Set(pending).size).toBe(1)
  expect(reads).toHaveLength(1)
  reads[0].resolve(1)
  await first
  await flush()
  expect(delivered).toEqual([])
  expect(reads).toHaveLength(2)
  reads[1].resolve(2)
  await Promise.all(pending)
  expect(delivered).toEqual([2])
  expect(reads).toHaveLength(2)
})

test('refresh during the rerun schedules one further read without losing demand', async () => {
  const { refresh, reads, delivered } = fixture()
  const first = refresh()
  const second = refresh()
  await flush()
  reads[0].resolve(1)
  await first
  await flush()
  const third = refresh()
  expect(refresh()).toBe(third)
  reads[1].resolve(2)
  await second
  await flush()
  expect(delivered).toEqual([])
  expect(reads).toHaveLength(3)
  reads[2].resolve(3)
  await third
  expect(delivered).toEqual([3])
})

test('an active failure rejects its caller and preserves the queued refresh', async () => {
  const { refresh, reads, delivered } = fixture()
  const first = refresh()
  const rejected = Promise.allSettled([first])
  const pending = refresh()
  await flush()
  reads[0].reject(new Error('first read failed'))
  expect(await rejected).toEqual([{ status: 'rejected', reason: new Error('first read failed') }])
  await flush()
  expect(reads).toHaveLength(2)
  reads[1].resolve(2)
  await pending
  expect(delivered).toEqual([2])
})

test('a failed queued read settles every queued caller and a later refresh can retry', async () => {
  const { refresh, reads, delivered } = fixture()
  const first = refresh()
  const pending = [refresh(), refresh(), refresh()]
  const outcomes = Promise.allSettled(pending)
  await flush()
  reads[0].resolve(1)
  await first
  await flush()
  reads[1].reject(new Error('queued read failed'))
  expect((await outcomes).map(({ status }) => status)).toEqual(['rejected', 'rejected', 'rejected'])
  const retry = refresh()
  await flush()
  reads[2].resolve(3)
  await retry
  expect(delivered).toEqual([3])
})

test('abort suppresses active delivery and pending reads; calls after disposal settle', async () => {
  const { refresh, reads, delivered, controller } = fixture()
  const first = refresh()
  await flush()
  const pending = refresh()
  controller.abort()
  await refresh()
  reads[0].resolve(1)
  await Promise.all([first, pending])
  expect(delivered).toEqual([])
  expect(reads).toHaveLength(1)
})

test('abort before the scheduled read prevents all IO', async () => {
  const { refresh, reads, controller } = fixture()
  const first = refresh()
  controller.abort()
  await first
  await refresh()
  expect(reads).toHaveLength(0)
})

test('refresh requested synchronously by delivery is not lost', async () => {
  const controller = new AbortController()
  const delivered: number[] = []
  let count = 0
  let pending: Promise<void> | undefined
  const refresh = coalesced_reader(
    async () => ++count,
    (value) => {
      delivered.push(value)
      if (value === 1) pending = refresh()
    },
    controller.signal
  )
  await refresh()
  await pending
  expect(delivered).toEqual([1, 2])
})

// Deterministic account-initialization model: one baseline read, then one refresh per
// newly acquired character watch, matching player_events. This measures read amplification,
// not FalkorDB latency, Redis subscription costs, memory, or production throughput.
const account_work = async (accounts: number, characters: number, coalesce: boolean) => {
  const work = await Promise.all(
    Array.from({ length: accounts }, async () => {
      let gate = deferred<void>()
      let read_calls = 0
      let roster_rows = 0
      const read = async () => {
        read_calls += 1
        roster_rows += characters
        await gate.promise
        return Array.from({ length: characters }, (_, index) => index)
      }
      const deliver = () => {}
      const refresh = coalesce
        ? coalesced_reader(read, deliver, new AbortController().signal)
        : latest_reader(read, deliver)
      const baseline = refresh()
      await flush()
      gate.resolve()
      await baseline
      gate = deferred<void>()
      const watches = Array.from({ length: characters }, refresh)
      await flush()
      gate.resolve()
      await Promise.all(watches)
      return { read_calls, roster_rows }
    })
  )
  return work.reduce(
    (total, account) => ({
      read_calls: total.read_calls + account.read_calls,
      roster_rows: total.roster_rows + account.roster_rows,
    }),
    { read_calls: 0, roster_rows: 0 }
  )
}

test('equal 100-character initialization workloads expose account read amplification', async () => {
  expect(await account_work(100, 1, false)).toEqual({ read_calls: 200, roster_rows: 200 })
  expect(await account_work(10, 10, false)).toEqual({ read_calls: 110, roster_rows: 1100 })
  expect(await account_work(100, 1, true)).toEqual({ read_calls: 200, roster_rows: 200 })
  expect(await account_work(10, 10, true)).toEqual({ read_calls: 30, roster_rows: 300 })
})
