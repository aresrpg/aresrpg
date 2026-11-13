// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test, spyOn } from 'bun:test'

import { create_balance_cache } from '../src/balance.ts'

describe('SUI balance cache', () => {
  test('shares one in-flight read and keeps it for five seconds', async () => {
    let now_ms = 1_000
    let reads = 0
    const cache = create_balance_cache({
      get_balance: async () => {
        reads += 1
        return 42n
      },
      now: () => now_ms,
    })

    expect(await Promise.all([cache.read('0xA'), cache.read('0xa')])).toEqual([42n, 42n])
    expect(reads).toBe(1)
    now_ms += 4_999
    expect(await cache.read('0xA')).toBe(42n)
    expect(reads).toBe(1)
    now_ms += 2
    expect(await cache.read('0xA')).toBe(42n)
    expect(reads).toBe(2)
  })

  test('an invalidation forces the next read through', async () => {
    let balance = 1n
    const cache = create_balance_cache({ get_balance: async () => balance })
    expect(await cache.read('0x1')).toBe(1n)
    balance = 2n
    cache.invalidate('0x1')
    expect(await cache.read('0x1')).toBe(2n)
  })

  test('an invalidation supersedes an older in-flight read', async () => {
    const resolvers: ((value: bigint) => void)[] = []
    const cache = create_balance_cache({
      get_balance: () =>
        new Promise<bigint>((resolve) => {
          resolvers.push(resolve)
        }),
    })

    const stale = cache.read('0x1')
    cache.invalidate('0x1')
    const fresh = cache.read('0x1')
    expect(resolvers).toHaveLength(2)

    resolvers[1]!(2n)
    expect(await fresh).toBe(2n)
    resolvers[0]!(1n)
    expect(await stale).toBe(1n)
    expect(await cache.read('0x1')).toBe(2n)
  })
})

test('balance snapshots retain the original sample age, isolate accounts, and invalidate in-flight samples', async () => {
  let time = 1000
  const readers: ((value: bigint) => void)[] = []
  const cache = create_balance_cache({
    now: () => time,
    get_balance: () => new Promise<bigint>((resolve) => readers.push(resolve)),
  })
  const a = cache.read_snapshot('0xA')
  time = 2000
  readers[0]!(9007199254740993n)
  expect(await a).toEqual({
    address: '0xa',
    balance_mist: '9007199254740993',
    sampled_at_ms: 1000,
    expires_at_ms: 6000,
  })
  time = 3000
  expect((await cache.read_snapshot('0xa'))?.sampled_at_ms).toBe(1000)
  const b = cache.read_snapshot('0xb')
  readers[1]!(0n)
  expect((await b)?.balance_mist).toBe('0')
  cache.invalidate('0xa')
  const invalidated = cache.read_snapshot('0xa')
  cache.invalidate('0xa')
  readers[2]!(4n)
  expect(await invalidated).toBeNull()
})

test('wall-clock corrections cannot rejuvenate a cached balance sample', async () => {
  let monotonic = 1000
  const time = spyOn(performance, 'now').mockImplementation(() => monotonic)
  const wall = spyOn(Date, 'now').mockReturnValue(1000000)
  let reads = 0
  const cache = create_balance_cache({ get_balance: async () => BigInt(++reads) })
  try {
    expect((await cache.read_snapshot('0xa'))?.balance_mist).toBe('1')
    monotonic += 5001
    wall.mockReturnValue(1)
    expect((await cache.read_snapshot('0xa'))?.balance_mist).toBe('2')
    expect(reads).toBe(2)
  } finally {
    time.mockRestore()
    wall.mockRestore()
  }
})
