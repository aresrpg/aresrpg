// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { DEFAULT_RATE_LIMIT_MAX, DEFAULT_RATE_LIMIT_WINDOW_SEC, check_rate_limit } from './rate_limit.js'

function memory_store() {
  const calls = []
  const counts = new Map()
  return {
    calls,
    async send(command, args) {
      calls.push([command, args])
      if (command === 'INCR') {
        const count = (counts.get(args[0]) ?? 0) + 1
        counts.set(args[0], count)
        return count
      }
      return 1
    },
  }
}

describe('read API rate limit', () => {
  test('defaults to 300 requests per IP per 60 seconds', () => {
    expect(DEFAULT_RATE_LIMIT_MAX).toBe(300)
    expect(DEFAULT_RATE_LIMIT_WINDOW_SEC).toBe(60)
  })

  test('admits the configured window and reports its actual remaining wait', async () => {
    const store = memory_store()
    const options = { store, max: 3, window_sec: 10, now_ms: 42_500 }

    const first = await check_rate_limit('203.0.113.5', options)
    const second = await check_rate_limit('203.0.113.5', options)
    const third = await check_rate_limit('203.0.113.5', options)
    const limited = await check_rate_limit('203.0.113.5', options)

    expect([first.allowed, second.allowed, third.allowed, limited.allowed]).toEqual([true, true, true, false])
    expect([first.remaining, second.remaining, third.remaining, limited.remaining]).toEqual([2, 1, 0, 0])
    expect(limited).toMatchObject({ limit: 3, retry_after: 8 })
    expect(store.calls.filter(([command]) => command === 'EXPIRE')).toEqual([
      ['EXPIRE', ['rpc:rl:203.0.113.5:4', '10']],
    ])
  })

  test('starts a fresh counter at the next fixed-window boundary', async () => {
    const store = memory_store()
    const before = await check_rate_limit('203.0.113.5', {
      store,
      max: 1,
      window_sec: 10,
      now_ms: 49_999,
    })
    const after = await check_rate_limit('203.0.113.5', {
      store,
      max: 1,
      window_sec: 10,
      now_ms: 50_000,
    })

    expect(before).toMatchObject({ allowed: true, retry_after: 1 })
    expect(after).toMatchObject({ allowed: true, retry_after: 10 })
  })
})
