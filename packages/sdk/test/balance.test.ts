// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

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
})
