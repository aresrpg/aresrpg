// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { WORLD_POLL_STAGGER_MS, create_world_poll_scheduler } from './world_poll_scheduler'

type Timer = { at: number; run: () => void }

function fake_clock() {
  let now_ms = 0
  let next_id = 1
  let max_live_timers = 0
  const timers = new Map<number, Timer>()

  const set_timeout = (handler: () => void, delay_ms: number) => {
    const id = next_id++
    timers.set(id, { at: now_ms + Math.max(0, delay_ms), run: handler })
    max_live_timers = Math.max(max_live_timers, timers.size)
    return id
  }
  const clear_timeout = (id: number) => timers.delete(id)
  const advance_to = async (target_ms: number) => {
    while (true) {
      const [next] = [...timers.entries()].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])
      if (!next || next[1].at > target_ms) break
      timers.delete(next[0])
      now_ms = next[1].at
      next[1].run()
      for (let i = 0; i < 4; i += 1) await Promise.resolve()
    }
    now_ms = target_ms
    for (let i = 0; i < 4; i += 1) await Promise.resolve()
  }

  return {
    now: () => now_ms,
    set_timeout,
    clear_timeout,
    advance_to,
    max_live_timers: () => max_live_timers,
  }
}

describe('world poll scheduler', () => {
  test('coalesces duplicate keys and starts each cold request kind immediately', async () => {
    const clock = fake_clock()
    const scheduler = create_world_poll_scheduler({
      now: clock.now,
      set_timeout: clock.set_timeout,
      clear_timeout: clock.clear_timeout,
      is_paused: () => false,
    })
    const starts: Array<{ key: string; at: number }> = []
    const run = (key: string) => async () => {
      starts.push({ key, at: clock.now() })
      return key
    }

    const zones = scheduler.schedule('zones:world-a', run('zones:world-a'))
    const duplicate = scheduler.schedule('zones:world-a', run('duplicate-must-not-run'))
    const fights = scheduler.schedule('fights:world-a', run('fights:world-a'))
    const party = scheduler.schedule('party:character-a', run('party:character-a'))

    expect(duplicate).toBe(zones)
    await clock.advance_to(0)
    await Promise.all([zones, duplicate, fights, party])

    expect(starts.map(({ key }) => key)).toEqual(['zones:world-a', 'fights:world-a', 'party:character-a'])
    expect(starts.map(({ at }) => at)).toEqual([0, 0, 0])
    expect(clock.max_live_timers()).toBe(0)
  })

  test('keeps repeat reads of one kind on the staggered ticker', async () => {
    const clock = fake_clock()
    const scheduler = create_world_poll_scheduler({
      now: clock.now,
      set_timeout: clock.set_timeout,
      clear_timeout: clock.clear_timeout,
      is_paused: () => false,
    })
    const starts: number[] = []
    const run = async () => {
      starts.push(clock.now())
      return null
    }

    const list = scheduler.schedule('https://rpc.test/v1/zones?world=a', run)
    const first_cell = scheduler.schedule('https://rpc.test/v1/zones?world=a&zone=1:1', run)
    const second_cell = scheduler.schedule('https://rpc.test/v1/zones?world=a&zone=1:2', run)

    await clock.advance_to(WORLD_POLL_STAGGER_MS * 2)
    await Promise.all([list, first_cell, second_cell])

    expect(starts).toEqual([0, WORLD_POLL_STAGGER_MS, WORLD_POLL_STAGGER_MS * 2])
    expect(clock.max_live_timers()).toBe(1)
  })

  test('promotes an already queued poll when a same-key fresh reconciliation joins it', async () => {
    const clock = fake_clock()
    const scheduler = create_world_poll_scheduler({
      now: clock.now,
      set_timeout: clock.set_timeout,
      clear_timeout: clock.clear_timeout,
      is_paused: () => false,
    })
    const starts: string[] = []
    const run = (key: string) => async () => {
      starts.push(key)
      return key
    }

    const first = scheduler.schedule('https://rpc.test/v1/zones?world=a', run('zones:world-a'))
    const blocker = scheduler.schedule('https://rpc.test/v1/zones?world=a&zone=1:1', run('zone:world-a:blocker'))
    const old = scheduler.schedule('https://rpc.test/v1/zones?world=a&zone=1:2', run('zone:world-a:old'))
    await clock.advance_to(0)
    const fresh = scheduler.schedule('https://rpc.test/v1/zones?world=a&zone=1:2', run('duplicate-must-not-run'), true)
    await clock.advance_to(WORLD_POLL_STAGGER_MS * 3)
    await Promise.all([first, blocker, old, fresh])

    expect(fresh).toBe(old)
    expect(starts).toEqual(['zones:world-a', 'zone:world-a:old', 'zone:world-a:blocker'])
    expect(clock.max_live_timers()).toBe(1)
  })

  test('caps a worst-case world wave at 80/min, leaving 40 requests of the shared server budget', async () => {
    const clock = fake_clock()
    const scheduler = create_world_poll_scheduler({
      now: clock.now,
      set_timeout: clock.set_timeout,
      clear_timeout: clock.clear_timeout,
      is_paused: () => false,
    })
    const starts: number[] = []
    const keys = [
      'characters:selected',
      'party:selected',
      'zones:world-a',
      ...Array.from({ length: 9 }, (_, index) => `zone:world-a:${index}`),
      'fights:world-a',
    ]

    for (let requested_at = 0; requested_at < 60_000; requested_at += 6000) {
      await clock.advance_to(requested_at)
      for (const key of keys)
        void scheduler.schedule(key, async () => {
          starts.push(clock.now())
          return key
        })
    }
    await clock.advance_to(59_999)

    const steady_starts = starts.filter((started_at) => started_at > 0)
    expect(steady_starts.length).toBeLessThanOrEqual(80)
    expect(new Set(steady_starts).size).toBe(steady_starts.length)
    expect(clock.max_live_timers()).toBe(1)
  })
})
