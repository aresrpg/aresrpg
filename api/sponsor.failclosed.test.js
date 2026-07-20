// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// api/sponsor.mjs FAIL-CLOSED proof: when Redis is UNREACHABLE, every anti-drain gate REFUSES
// (never fail-open on the money path). Point REDIS_URL at a DEAD port (nothing
// listening) so the first op errors and the circuit breaker trips:
//
//   REDIS_URL=redis://127.0.0.1:6390 bun test api/sponsor.failclosed.test.js
//
// Separate invocation from sponsor.test.js on purpose: sponsor state memoizes REDIS_URL + its client at
// module load, so live-store and down-store behavior must be exercised in different processes.

import { describe, expect, test } from 'bun:test'

const url = process.env.REDIS_URL || 'redis://127.0.0.1:6390'
// A live cache would NOT refuse, silently defeating the test — insist on a dead/non-live target.
if (/:6379(\/|$)|\/\/127\.0\.0\.1$|\/\/localhost$/.test(url))
  throw new Error(`failclosed test needs a DEAD port (e.g. redis://127.0.0.1:6390), not the live cache. Got ${url}`)
process.env.REDIS_URL = url
const S = await import('./sponsor.mjs')

// The FIRST op pays the real connect timeout (bounded ≈5s) before rejecting; the circuit breaker then
// fast-fails the rest. Give each test headroom over Bun's default 5s per-test limit.
const T = 15_000
describe('Redis unreachable ⇒ every gate FAILS CLOSED (refuse, never fail-open)', () => {
  test(
    'per-IP rate limit → true (429, refuse)',
    async () => {
      expect(await S.rate_limited('1.2.3.4')).toBe(true)
    },
    T
  )
  test(
    'per-address rate limit → true (refuse)',
    async () => {
      expect(await S.addr_rate_limited('0xabc')).toBe(true)
    },
    T
  )
  test(
    'per-address DAILY cap → Redis down falls to the in-memory shadow and STILL enforces (never fail-open)',
    async () => {
      const addr = '0xfailclosed'
      // record fills the in-memory shadow (the Redis write is best-effort and fails); the cap must still bite.
      await S.addr_daily_record(addr, S.ADDR_DAILY_CAP_MIST)
      expect(await S.addr_daily_would_exceed(addr, 1n)).toBe(true) // 1 mist over a full cap → refuse, not fail-open
    },
    T
  )
  test(
    'CONFIGURED-but-DOWN with the breaker engaged → IMMEDIATE refusal (fast-fail, still refuse — never in-memory)',
    async () => {
      // The tests above already tripped the breaker (the first op paid the ~5s bounded connect timeout). Inside
      // the 15s cooldown a rate check must refuse INSTANTLY — proving the down-store class stays fail-closed and
      // never silently degrades into the no-store in-memory fallback (that fallback would have returned false here).
      const t0 = performance.now()
      expect(await S.rate_limited('9.9.9.9')).toBe(true) // refuse — a CONFIGURED store is down
      expect(performance.now() - t0).toBeLessThan(4000) // breaker fast-fail, not another full connect timeout
    },
    T
  )
})
