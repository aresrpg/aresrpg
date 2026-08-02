// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST (#242 read-layer census): CompassStrip, DiscoveryPrompts, and world_spawns.js each ran their OWN
// useRpcView/setInterval instance for the IDENTICAL /v1/zones read, tripling the request rate for one
// player's data; the sponsor allowance hook did the same across its mount sites. This proves the shared
// primitive both fixes: one timer per key regardless of subscriber count, coalesced fetches, and a stop the
// instant the last subscriber releases — never a background poll outliving every consumer.
import { describe, expect, mock, test } from 'bun:test'

import { create_shared_poll } from './shared_poll'

function fake_interval() {
  const handlers = new Map<number, () => void>()
  let next_id = 1
  return {
    set_interval: (handler: () => void) => {
      const id = next_id++
      handlers.set(id, handler)
      return id as unknown as ReturnType<typeof setInterval>
    },
    clear_interval: (id: unknown) => {
      handlers.delete(id as number)
    },
    fire: async () => {
      for (const handler of [...handlers.values()]) handler()
      // let the tick()'s awaited fetch + its .then publish settle before the caller asserts.
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    },
    live_count: () => handlers.size,
  }
}

describe('create_shared_poll', () => {
  test('two subscribers to the SAME key share one timer and one fetch per tick', async () => {
    const clock = fake_interval()
    let calls = 0
    const poll = create_shared_poll(
      async (key: string) => {
        calls += 1
        return `${key}:${calls}`
      },
      6000,
      clock
    )

    const seen_a: unknown[] = []
    const seen_b: unknown[] = []
    const release_a = poll.subscribe('world-1', (v) => seen_a.push(v.data))
    const release_b = poll.subscribe('world-1', (v) => seen_b.push(v.data))

    expect(clock.live_count()).toBe(1) // ONE timer, not two
    await Promise.resolve()
    await Promise.resolve()
    expect(calls).toBe(1) // ONE fetch on start, shared by both subscribers

    await clock.fire()
    expect(calls).toBe(2) // one fetch per tick, still shared
    expect(seen_a.at(-1)).toBe('world-1:2')
    expect(seen_b.at(-1)).toBe('world-1:2')

    release_a()
    expect(clock.live_count()).toBe(1) // second subscriber still holds it open
    release_b()
    expect(clock.live_count()).toBe(0) // last release stops the timer — no background leak
  })

  test('different keys get independent timers', async () => {
    const clock = fake_interval()
    const poll = create_shared_poll(async (key: string) => key, 6000, clock)
    const release_a = poll.subscribe('world-1', () => {})
    const release_b = poll.subscribe('world-2', () => {})
    expect(clock.live_count()).toBe(2)
    release_a()
    expect(clock.live_count()).toBe(1) // world-2's timer is untouched by world-1's release
    release_b()
    expect(clock.live_count()).toBe(0)
  })

  test('a failed tick keeps the prior data and marks stale, never a silent blank', async () => {
    const clock = fake_interval()
    let fail = false
    const poll = create_shared_poll(
      async (key: string) => {
        if (fail) throw new Error('rpc down')
        return `${key}:ok`
      },
      6000,
      clock
    )
    const seen: Array<{ data: unknown; stale: boolean }> = []
    poll.subscribe('world-1', (v) => seen.push({ data: v.data, stale: v.stale }))
    await Promise.resolve()
    await Promise.resolve()
    expect(seen.at(-1)).toEqual({ data: 'world-1:ok', stale: false })

    fail = true
    await clock.fire()
    expect(seen.at(-1)).toEqual({ data: 'world-1:ok', stale: true }) // prior data held, flagged stale
  })

  test('refetch forces an out-of-band read without waiting for the next tick', async () => {
    const clock = fake_interval()
    let calls = 0
    const poll = create_shared_poll(
      async () => {
        calls += 1
        return calls
      },
      6000,
      clock
    )
    poll.subscribe('world-1', () => {})
    await Promise.resolve()
    await Promise.resolve()
    expect(calls).toBe(1)
    poll.refetch('world-1')
    await Promise.resolve()
    await Promise.resolve()
    expect(calls).toBe(2)
  })

  test('refetch on a key nobody subscribes to is a safe no-op', () => {
    const clock = fake_interval()
    const fetcher = mock(async () => 'x')
    const poll = create_shared_poll(fetcher, 6000, clock)
    poll.refetch('nobody-home')
    expect(fetcher).not.toHaveBeenCalled()
  })
})
