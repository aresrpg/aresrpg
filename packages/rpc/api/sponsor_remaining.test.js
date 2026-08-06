// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// /v1/sponsor/remaining over a real Redis 8 — the READ half of the daily sponsor
// allowance. It proves the shared-counter CONTRACT with api/sponsor.mjs: the sponsor
// PUBLISHES its cap to `sponsor:cap:addr_daily_mist` and INCRBYs
// `sponsor:spent:{UTC-date}:{addr}` on each grant; this view GETs the SAME keys. The
// test seeds both exactly the way the sponsor does, then asserts allowance − spent
// math, the clamp at the cap, and resets_at = next UTC midnight. Point REDIS_URL at a
// throwaway redis:8 and run:
//
//   docker run -d --rm -p 6399:6379 redis:8
//   REDIS_URL=redis://127.0.0.1:6399 bun test sponsor_remaining
//
// The cap is NOT read from this suite's env: the endpoint takes it from the store the
// sponsor published it to (#2197), so the suite publishes it there too. Seeding it from
// an env of its own is how these assertions went dead — the key was never written, the
// handler refused (503) and every `data.*` read below was undefined against undefined.
//
// assert_test_redis.js (imported FIRST) refuses to run against the live cache.

import './assert_test_redis.js'
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { redis, sponsor_redis } from './redis.js'
import { handle_sponsor_remaining } from './views.js'

// #2270 — the endpoint reads the SPONSOR-scoped connection. Seeding through the guarded `redis`
// client is only the same store in the single-instance shape assert_test_redis actually validates,
// so refuse loudly rather than seed a store the handler will not read.
if (sponsor_redis !== redis)
  throw new Error(
    'REFUSING TO RUN: SPONSOR_REDIS_URL points the endpoint at a store this suite neither seeds nor ' +
      'guards (assert_test_redis validates REDIS_URL). Unset it to run this oracle.'
  )

const P = (q) => new URLSearchParams(q)
const ADDR = '0x00000000000000000000000000000000000000000000000000000000000005e1'
const UTC_DAY = new Date().toISOString().slice(0, 10)
const KEY = `sponsor:spent:${UTC_DAY}:${ADDR.toLowerCase()}`
const CAP_KEY = 'sponsor:cap:addr_daily_mist'

// Mimic the sponsor's grant EXACTLY: INCRBY the per-day per-addr counter (api/sponsor_state.mjs
// addr_daily_hold books it at reserve, settle_daily_hold corrects it to the executed charge).
// Using the sponsor's own key scheme is the point — a drift here would mean the client shows a
// remaining detached from what the sponsor enforces. An in-flight reservation counts against that
// remaining on purpose: a hold IS a commitment to spend, and it is released if it never executes.
const grant = (mist) => redis.send('INCRBY', [KEY, String(mist)])

// Mimic the sponsor's boot: SET the cap it enforces (api/sponsor_state.mjs publish_addr_daily_cap).
// 5 SUI — the raised testnet cap, pointedly NOT the 1 SUI the retired env of this service defaulted
// to, so a handler that ever reads a number of its own answers wrong here instead of by luck.
const CAP = 5_000_000_000n
const publish_cap = () => redis.send('SET', [CAP_KEY, String(CAP)])

beforeEach(async () => {
  await redis.send('DEL', [KEY])
  await publish_cap()
})
afterAll(async () => {
  await redis.send('DEL', [KEY])
  await redis.send('DEL', [CAP_KEY])
})

describe('/v1/sponsor/remaining', () => {
  test('no spend yet → full allowance, spent 0', async () => {
    const { status, data } = await handle_sponsor_remaining(P(`address=${ADDR}`))
    expect(status).toBe(200)
    expect(data.allowance_mist).toBe(CAP.toString())
    expect(data.spent_mist).toBe('0')
    expect(data.remaining_mist).toBe(CAP.toString())
    // resets_at is the next UTC midnight, strictly in the future, at 00:00:00Z.
    expect(data.resets_at.endsWith('T00:00:00.000Z')).toBe(true)
    expect(new Date(data.resets_at).getTime()).toBeGreaterThan(Date.now())
  })

  test('partial spend → allowance − spent', async () => {
    await grant(2_000_000) // one sponsored tx (EST_GAS_MIST)
    await grant(2_000_000) // a second
    const { data } = await handle_sponsor_remaining(P(`address=${ADDR}`))
    expect(data.spent_mist).toBe('4000000')
    expect(data.remaining_mist).toBe((CAP - 4_000_000n).toString())
  })

  test('spend at/over the cap → remaining clamps to 0 (never negative)', async () => {
    await grant(CAP + 5_000_000n) // overshoot the daily cap
    const { data } = await handle_sponsor_remaining(P(`address=${ADDR}`))
    expect(data.spent_mist).toBe((CAP + 5_000_000n).toString())
    expect(data.remaining_mist).toBe('0')
  })

  test('missing ?address → 400', async () => {
    const { status } = await handle_sponsor_remaining(P(''))
    expect(status).toBe(400)
  })

  test('malformed address → 400 (no key read)', async () => {
    const { status } = await handle_sponsor_remaining(P('address=not-an-address'))
    expect(status).toBe(400)
  })

  test('address case does not matter (key is normalized lowercase)', async () => {
    await grant(2_000_000)
    const upper = '0x' + ADDR.slice(2).toUpperCase()
    const { data } = await handle_sponsor_remaining(P(`address=${upper}`))
    expect(data.spent_mist).toBe('2000000') // same counter as the lowercase grant
  })

  // The refusal, against a REAL store: an unpublished cap is the one state that must never render a
  // number. This is also the positive control for every assertion above — it proves they only pass
  // because the cap key was seeded, and not because the handler invents one.
  test('cap not published → 503, uncached, no allowance number', async () => {
    await redis.send('DEL', [CAP_KEY])
    const { status, headers, data } = await handle_sponsor_remaining(P(`address=${ADDR}`))
    expect(status).toBe(503)
    expect(data.error).toBe('sponsor_cap_unavailable')
    expect(data.allowance_mist).toBeUndefined()
    expect(headers['cache-control']).toBe('no-store')
  })
})
