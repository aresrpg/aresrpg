// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { _reset_rpc_client_for_test, get_encyclopedia, get_fights, rpc_get } from './client'

const real_fetch = globalThis.fetch
const real_set_timeout = globalThis.setTimeout
const real_clear_timeout = globalThis.clearTimeout
const real_random = Math.random
const real_date_now = Date.now

const json_response = (body: unknown, status = 200, headers?: HeadersInit) => {
  const response_headers = new Headers(headers)
  response_headers.set('content-type', 'application/json')
  return new Response(JSON.stringify(body), { status, headers: response_headers })
}

function immediate_timers(delays: number[]): void {
  globalThis.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
    delays.push(Number(delay ?? 0))
    queueMicrotask(() => {
      if (typeof handler === 'function') handler(...args)
    })
    return 1
  }) as typeof setTimeout
  globalThis.clearTimeout = (() => undefined) as typeof clearTimeout
}

function advancing_retry_timers(delays: number[]): void {
  let now_ms = 10_000
  Date.now = () => now_ms
  globalThis.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
    const delay_ms = Number(delay ?? 0)
    if (delay_ms !== 8000) {
      delays.push(delay_ms)
      queueMicrotask(() => {
        now_ms += delay_ms
        if (typeof handler === 'function') handler(...args)
      })
    }
    return 1
  }) as typeof setTimeout
  globalThis.clearTimeout = (() => undefined) as typeof clearTimeout
}

beforeEach(() => {
  _reset_rpc_client_for_test()
})

afterEach(() => {
  globalThis.fetch = real_fetch
  globalThis.setTimeout = real_set_timeout
  globalThis.clearTimeout = real_clear_timeout
  Math.random = real_random
  Date.now = real_date_now
  _reset_rpc_client_for_test()
})

describe('rpc GET request control', () => {
  test('coalesces two concurrent identical GETs into one network call', async () => {
    let release!: (response: Response) => void
    const held_response = new Promise<Response>((resolve) => {
      release = resolve
    })
    const fetch_mock = mock(() => held_response)
    globalThis.fetch = fetch_mock as unknown as typeof fetch

    const first = rpc_get<{ value: number }>('/v1/test-dedupe', { id: 'same' })
    const second = rpc_get<{ value: number }>('/v1/test-dedupe', { id: 'same' })

    expect(fetch_mock).toHaveBeenCalledTimes(1)
    release(json_response({ value: 7 }))
    expect(await Promise.all([first, second])).toEqual([{ value: 7 }, { value: 7 }])
    expect(fetch_mock).toHaveBeenCalledTimes(1)
  })

  test('honors Retry-After with jitter and retries a 429 only once', async () => {
    const delays: number[] = []
    immediate_timers(delays)
    Math.random = () => 0.25

    let fetch_count = 0
    const fetch_mock = mock(async () =>
      ++fetch_count === 1
        ? json_response({ error: 'rate_limited', retry_after_seconds: 2 }, 429, { 'retry-after': '9' })
        : json_response({ ok: true })
    )
    globalThis.fetch = fetch_mock as unknown as typeof fetch

    await expect(rpc_get<{ ok: boolean }>('/v1/test-retry')).resolves.toEqual({ ok: true })
    expect(fetch_mock).toHaveBeenCalledTimes(2)
    const [retry_delay] = delays.filter((delay) => delay !== 8000)
    expect(retry_delay).toBeGreaterThanOrEqual(9000)
    expect(retry_delay).toBeLessThan(10000)
  })

  test('holds new requests behind an active Retry-After gate', async () => {
    let release_retry: (() => void) | undefined
    let now_ms = 0
    Date.now = () => now_ms
    globalThis.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
      const delay_ms = Number(delay ?? 0)
      if (delay_ms !== 8000)
        release_retry = () => {
          now_ms += delay_ms
          if (typeof handler === 'function') handler(...args)
        }
      return 1
    }) as typeof setTimeout
    globalThis.clearTimeout = (() => undefined) as typeof clearTimeout

    const starts: string[] = []
    let limited_count = 0
    const fetch_mock = mock(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname
      starts.push(path)
      if (path.endsWith('/limited') && ++limited_count === 1)
        return json_response({ retry_after_seconds: 1 }, 429, { 'retry-after': '1' })
      return json_response({ ok: true })
    })
    globalThis.fetch = fetch_mock as unknown as typeof fetch

    const limited = rpc_get('/v1/test-gate/limited')
    for (let i = 0; i < 12 && !release_retry; i += 1) await Promise.resolve()
    expect(release_retry).toBeDefined()

    const follower = rpc_get('/v1/test-gate/follower')
    for (let i = 0; i < 4; i += 1) await Promise.resolve()
    const starts_before_release = [...starts]
    release_retry?.()
    await Promise.all([limited, follower])

    expect(starts_before_release).toEqual(['/v1/test-gate/limited'])
    expect(starts).toEqual(['/v1/test-gate/limited', '/v1/test-gate/limited', '/v1/test-gate/follower'])
  })

  test('uses exponential fallback per endpoint class when Retry-After is absent', async () => {
    let now_ms = 0
    Date.now = () => now_ms
    const retry_timers: Array<{ delay_ms: number; run: () => void }> = []
    globalThis.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
      const delay_ms = Number(delay ?? 0)
      if (delay_ms !== 8000)
        retry_timers.push({
          delay_ms,
          run: () => {
            now_ms += delay_ms
            if (typeof handler === 'function') handler(...args)
          },
        })
      return retry_timers.length + 1
    }) as typeof setTimeout
    globalThis.clearTimeout = (() => undefined) as typeof clearTimeout
    Math.random = () => 0

    const calls = new Map<string, number>()
    const retry_starts: number[] = []
    const fetch_mock = mock(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname
      const count = (calls.get(path) ?? 0) + 1
      calls.set(path, count)
      if (count === 1) return json_response({ error: 'rate_limited' }, 429)
      retry_starts.push(now_ms)
      return json_response({ ok: true })
    })
    globalThis.fetch = fetch_mock as unknown as typeof fetch

    const first = rpc_get('/v1/test-exponential/a')
    const second = rpc_get('/v1/test-exponential/b')
    for (let i = 0; i < 16 && retry_timers.length === 0; i += 1) await Promise.resolve()
    while (retry_timers.length) {
      retry_timers.shift()?.run()
      for (let i = 0; i < 16; i += 1) await Promise.resolve()
    }
    await Promise.all([first, second])

    expect(retry_starts).toEqual([2000, 2000])
  })

  test('serializes retries for different URLs behind the shared 429 gate', async () => {
    immediate_timers([])
    Math.random = () => 0
    const calls = new Map<string, number>()
    let release_first_retry!: () => void
    const first_retry_held = new Promise<void>((resolve) => {
      release_first_retry = resolve
    })
    let mark_first_retry!: () => void
    const first_retry_started = new Promise<void>((resolve) => {
      mark_first_retry = resolve
    })

    const fetch_mock = mock(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname
      const count = (calls.get(path) ?? 0) + 1
      calls.set(path, count)
      if (count === 1) return json_response({ retry_after_seconds: 0 }, 429)
      if (path.endsWith('/a')) {
        mark_first_retry()
        await first_retry_held
      }
      return json_response({ path })
    })
    globalThis.fetch = fetch_mock as unknown as typeof fetch

    const a = rpc_get<{ path: string }>('/v1/test-queue/a')
    const b = rpc_get<{ path: string }>('/v1/test-queue/b')
    await first_retry_started
    expect(calls.get('/v1/test-queue/a')).toBe(2)
    expect(calls.get('/v1/test-queue/b')).toBe(1)
    release_first_retry()
    await Promise.all([a, b])
    expect(calls.get('/v1/test-queue/b')).toBe(2)
  })

  test('extends the gate for queued retries when an earlier retry is limited again', async () => {
    let now_ms = 0
    Date.now = () => now_ms
    const retry_timers: Array<{ delay_ms: number; run: () => void }> = []
    globalThis.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
      const delay_ms = Number(delay ?? 0)
      if (delay_ms !== 8000)
        retry_timers.push({
          delay_ms,
          run: () => {
            now_ms += delay_ms
            if (typeof handler === 'function') handler(...args)
          },
        })
      return retry_timers.length + 1
    }) as typeof setTimeout
    globalThis.clearTimeout = (() => undefined) as typeof clearTimeout
    Math.random = () => 0

    const calls = new Map<string, number>()
    let follower_retry_at: number | null = null
    const fetch_mock = mock(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname
      const count = (calls.get(path) ?? 0) + 1
      calls.set(path, count)
      if (count === 1) return json_response({ retry_after_seconds: 0 }, 429)
      if (path.endsWith('/a')) return json_response({ retry_after_seconds: 5 }, 429, { 'retry-after': '5' })
      follower_retry_at = now_ms
      return json_response({ ok: true })
    })
    globalThis.fetch = fetch_mock as unknown as typeof fetch

    const settled = Promise.allSettled([rpc_get('/v1/test-extended-gate/a'), rpc_get('/v1/test-extended-gate/b')])
    for (let i = 0; i < 20 && retry_timers.length === 0; i += 1) await Promise.resolve()
    while (retry_timers.length) {
      retry_timers.shift()?.run()
      for (let i = 0; i < 24; i += 1) await Promise.resolve()
    }
    const results = await settled

    expect(results.map(({ status }) => status)).toEqual(['rejected', 'fulfilled'])
    expect(follower_retry_at).toBe(5000)
  })

  test('gives a later 429 its own full Retry-After deadline', async () => {
    const retry_delays: number[] = []
    advancing_retry_timers(retry_delays)
    Math.random = () => 0
    const calls = new Map<string, number>()
    let release_first_retry!: () => void
    const first_retry_held = new Promise<void>((resolve) => {
      release_first_retry = resolve
    })
    let mark_first_retry!: () => void
    const first_retry_started = new Promise<void>((resolve) => {
      mark_first_retry = resolve
    })
    let release_second_429!: () => void
    const second_429_held = new Promise<void>((resolve) => {
      release_second_429 = resolve
    })

    const fetch_mock = mock(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname
      const count = (calls.get(path) ?? 0) + 1
      calls.set(path, count)
      if (count === 1) {
        if (path.endsWith('/b')) await second_429_held
        return json_response({ retry_after_seconds: 1 }, 429)
      }
      if (path.endsWith('/a')) {
        mark_first_retry()
        await first_retry_held
      }
      return json_response({ path })
    })
    globalThis.fetch = fetch_mock as unknown as typeof fetch

    const a = rpc_get('/v1/test-late-queue/a')
    const b = rpc_get('/v1/test-late-queue/b')
    await first_retry_started
    release_second_429()
    for (let i = 0; i < 8; i += 1) await Promise.resolve()
    expect(calls.get('/v1/test-late-queue/b')).toBe(1)
    release_first_retry()
    await Promise.all([a, b])
    expect(retry_delays).toEqual([1000, 1000])
    expect(calls.get('/v1/test-late-queue/b')).toBe(2)
  })

  test('emits one soft toast only when the single retry also fails', async () => {
    immediate_timers([])
    Math.random = () => 0
    const { use_toast } = await import('../toast')
    const original_add = use_toast.getState().add
    const add_mock = mock(() => undefined)
    use_toast.setState({ add: add_mock })
    const fetch_mock = mock(async () => json_response({ retry_after_seconds: 0 }, 429))
    globalThis.fetch = fetch_mock as unknown as typeof fetch

    try {
      const first = rpc_get('/v1/test-retry-failure')
      const duplicate = rpc_get('/v1/test-retry-failure')
      const results = await Promise.allSettled([first, duplicate])
      expect(results.map(({ status }) => status)).toEqual(['rejected', 'rejected'])
      expect(fetch_mock).toHaveBeenCalledTimes(2)
      expect(add_mock).toHaveBeenCalledTimes(1)
      expect(add_mock.mock.calls[0][1]).toBe('info')
    } finally {
      use_toast.setState({ add: original_add })
    }
  })

  test('serves every encyclopedia kind from one app-lifetime all-kinds request', async () => {
    const catalog = {
      items: [{ template_id: 'item' }],
      mobs: [{ template_id: 'mob' }],
      worlds: [{ world_id: 'world' }],
      recipes: [{ recipe_id: 'recipe' }],
    }
    const fetch_mock = mock(async () => json_response(catalog))
    globalThis.fetch = fetch_mock as unknown as typeof fetch

    expect((await get_encyclopedia('items')).items).toEqual(catalog.items)
    expect((await get_encyclopedia('mobs')).mobs).toEqual(catalog.mobs)
    expect(fetch_mock).toHaveBeenCalledTimes(1)
    expect(new URL(String(fetch_mock.mock.calls[0][0])).searchParams.has('kind')).toBe(false)
  })

  // ZONE-POLLER 429 REGRESSION (live-prod report 2026-07-19: `/v1/zones?world=…&zone=487:488` 429
  // repeating). world_spawns.js's poll() fans a SINGLE tick out to ONE list read (`/v1/zones?world=`) plus up
  // to NINE single-zone state reads (`/v1/zones?world=&zone=zx:zy`, the 3×3 discovered neighbourhood) — ten
  // distinct URLs sharing one pathname/endpoint-class, fired in the same microtask via Promise.all. The 429
  // body/headers below are the REAL shape packages/rpc/api/server.js:71-76 returns (mock-shape law): a fixed
  // per-IP window (rate_limit.js DEFAULT_RATE_LIMIT_MAX=300/60s) whose retry_after_seconds counts down to the
  // window boundary, so a well-behaved client backs off to that deadline rather than re-polling immediately.
  test('a 3x3 zone-neighbourhood burst backs off together and never drops a zone permanently', async () => {
    let now_ms = 0
    Date.now = () => now_ms
    const retry_timers: Array<{ delay_ms: number; run: () => void }> = []
    globalThis.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
      const delay_ms = Number(delay ?? 0)
      if (delay_ms !== 8000)
        // 8000 = the fetch abort timeout — left inert, matching the file's other tests
        retry_timers.push({
          delay_ms,
          run: () => {
            now_ms += delay_ms
            if (typeof handler === 'function') handler(...args)
          },
        })
      return retry_timers.length + 1
    }) as typeof setTimeout
    globalThis.clearTimeout = (() => undefined) as typeof clearTimeout
    Math.random = () => 0

    const calls = new Map<string, number>()
    const fetch_mock = mock(async (input: RequestInfo | URL) => {
      const url = String(input)
      const count = (calls.get(url) ?? 0) + 1
      calls.set(url, count)
      if (count === 1)
        return json_response({ error: 'rate_limited', limit: 300, retry_after_seconds: 3 }, 429, {
          'retry-after': '3',
          'x-ratelimit-limit': '300',
          'x-ratelimit-remaining': '0',
        })
      return json_response({ zones: [] })
    })
    globalThis.fetch = fetch_mock as unknown as typeof fetch

    const world = 'world-x'
    const list = rpc_get('/v1/zones', { world })
    const cells: Promise<unknown>[] = []
    for (let dx = -1; dx <= 1; dx += 1)
      for (let dy = -1; dy <= 1; dy += 1) cells.push(rpc_get('/v1/zones', { world, zone: `${5 + dx}:${5 + dy}` }))

    for (let i = 0; i < 40 && retry_timers.length === 0; i += 1) await Promise.resolve()
    while (retry_timers.length) {
      retry_timers.shift()?.run()
      for (let i = 0; i < 40; i += 1) await Promise.resolve()
    }
    const results = await Promise.allSettled([list, ...cells])

    expect(calls.size).toBe(10) // the list + all 9 neighbourhood cells each reached the network at least once
    // BACKS OFF, never hammers: every one of the 10 keys is fetched at most twice (the initial 429 + the one
    // gated retry) — no key is re-dispatched in a tight loop while the shared rate-limit window is blocked.
    for (const [url, n] of calls) expect(n, `over-fetched ${url}`).toBeLessThanOrEqual(2)
    // NEVER DROPS A ZONE (never-cache-absence law): every key's single gated retry lands once the shared
    // window opens — none rejects, none silently vanishes from the poll.
    expect(
      results.every((r) => r.status === 'fulfilled'),
      JSON.stringify(results)
    ).toBe(true)
  })
})

// ── #1317: THE JOIN AFFORDANCE'S READ IS TIME-CRITICAL ────────────────────────────────────────────────────
// A coop fight's placement window is ~60s, and the world-fights read that advertises it shares ONE staggered
// FIFO with the roam poll's zone neighbourhood (WORLD_POLL_STAGGER_MS apart). Queued behind that burst — and
// then answerable from another view's 3s-old LRU entry — the JOIN affordance lagged the fight by ~16s. These
// two pin the read's declared priority: it jumps the backlog, and it never accepts a cached snapshot.
describe('world-fights discovery read (#1317)', () => {
  test('a fresh /v1/fights read is served BEFORE a zone backlog already queued ahead of it', async () => {
    const order: string[] = []
    const delays: number[] = []
    immediate_timers(delays)
    globalThis.fetch = mock(async (input: unknown) => {
      const url = new URL(String(input))
      order.push(`${url.pathname}${url.search}`)
      return json_response({ fights: [], zones: [] })
    }) as unknown as typeof fetch

    const world = 'world-1317'
    const zones = [] as Promise<unknown>[]
    for (let i = 0; i < 4; i += 1) zones.push(rpc_get('/v1/zones', { world, zone: `5:${i}` }))
    const fights = get_fights({ world }, undefined, true) // the discovery poll's own call shape

    await Promise.all([...zones, fights])
    expect(order.length).toBe(5)
    // One cold zone read already bypassed the FIFO; fights is itself a first-kind boot read, so it starts
    // beside that read and ahead of every repeat-zone request still waiting its stagger turn.
    expect(order[0]).toBe(`/v1/zones?world=${world}&zone=5%3A0`)
    expect(order[1]).toBe(`/v1/fights?world=${world}`)
    expect(order.slice(2).every((url) => url.startsWith('/v1/zones'))).toBe(true)
  })

  test('a fresh /v1/fights read never answers from the LRU another view warmed', async () => {
    let calls = 0
    globalThis.fetch = mock(async () => {
      calls += 1
      return json_response({ fights: [] })
    }) as unknown as typeof fetch

    await get_fights({ world: 'world-lru' }) // a normal read warms the 3s LRU entry
    await get_fights({ world: 'world-lru' }) // …which a normal repeat happily serves
    expect(calls).toBe(1)
    await get_fights({ world: 'world-lru' }, undefined, true)
    expect(calls).toBe(2) // the discovery poll reached the network anyway
  })
})
