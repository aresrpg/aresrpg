// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// /v1/sponsor/remaining over a real Redis 8 — the READ half of the daily sponsor
// allowance. It proves the shared-counter CONTRACT with api/sponsor.mjs: the sponsor
// INCRBYs `sponsor:spent:{UTC-date}:{addr}` on each grant, and this view GETs the SAME
// key. The test seeds that exact key the same way the sponsor does (INCRBY), then
// asserts allowance − spent math, the clamp at the cap, and resets_at = next UTC
// midnight. Point REDIS_URL at a throwaway redis:8 and run:
//
//   docker run -d --rm -p 6399:6379 redis:8
//   SPONSOR_ADDR_DAILY_CAP_MIST=1000000000 REDIS_URL=redis://127.0.0.1:6399 bun test sponsor_remaining
//
// assert_test_redis.js (imported FIRST) refuses to run against the live cache.

import './assert_test_redis.js'
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { redis } from './redis.js'
import { handle_sponsor_remaining } from './views.js'

const P = (q) => new URLSearchParams(q)
const ADDR = '0x00000000000000000000000000000000000000000000000000000000000005e1'
const UTC_DAY = new Date().toISOString().slice(0, 10)
const KEY = `sponsor:spent:${UTC_DAY}:${ADDR.toLowerCase()}`

// Mimic the sponsor's grant EXACTLY: INCRBY the per-day per-addr counter (api/sponsor.mjs
// addr_daily_record). Using the sponsor's own key scheme is the point — a drift here would
// mean the client shows a remaining detached from what the sponsor enforces.
const grant = (mist) => redis.send('INCRBY', [KEY, String(mist)])

// The cap the handler reads from env (SPONSOR_ADDR_DAILY_CAP_MIST); default 1 SUI. We assert
// against whatever the suite was launched with so the test tracks the deployed cap.
const CAP = BigInt(process.env.SPONSOR_ADDR_DAILY_CAP_MIST || 1_000_000_000)

beforeEach(async () => {
  await redis.send('DEL', [KEY])
})
afterAll(async () => {
  await redis.send('DEL', [KEY])
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
})
