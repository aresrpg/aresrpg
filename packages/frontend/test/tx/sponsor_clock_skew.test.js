// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #2263 — A DEVICE CLOCK IS NOT A CLOCK THE SERVICE TRUSTS.
//
// The sponsor refuses any `aresrpg-sponsor:<sender>:<epoch-ms>` challenge whose timestamp is outside a
// 5-minute window (api/zklogin_auth.mjs `assert_zklogin_challenge_local`). The client minted that timestamp
// from `Date.now()`, so a player whose device clock ran ≥5 minutes fast or slow was refused on EVERY sponsored
// transaction, forever, with copy that told them to sign in again — which cannot help.
//
// Two facts are pinned here, both driven through the REAL sponsored door (execute_sponsored_tx) over a
// scripted wire that answers with a `Date` header, exactly as the service does:
//   1. the challenge is stamped against the SERVER's clock (device clock + measured offset), so a +10-minute
//      device lands inside the service's window;
//   2. when the measured offset is ≥2 minutes, the refusal copy names the clock and its remedy instead of the
//      generic "sign in again" line — and below that threshold the generic copy is untouched.
//
//   bun test ./test/tx/sponsor_clock_skew.test.js
//
// RED BEFORE THE FIX: (1) the challenge carried raw device time — 600000ms past the server, twice the 300000ms
// window; (2) a skewed refusal humanized to `errors.sponsor_zklogin` ("sign in again and retry").

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import i18n from '../../src/i18n'

import { ADDR, CHAIN, SPONSOR_URL, calls_to, make_tx, make_wallet, refusal_body } from './sponsor_door_harness.js'

const { execute_sponsored_tx } = await import('../../src/tx/index')
const { _reset_server_clock_for_test } = await import('../../src/core/server_clock.ts')

// The service's own window, restated here on purpose: this file's whole claim is "the stamp lands inside it".
const CHALLENGE_TTL_MS = 5 * 60_000
const DEVICE_SKEW_MS = 10 * 60_000 // the reported bug's magnitude — twice the window
const SMALL_SKEW_MS = 45_000 // real-world drift; below the copy threshold

/** The `Date` header a server writes, in the one format HTTP defines for it. */
const http_date = (ms) => new Date(ms).toUTCString()

/**
 * A sponsor wire whose /reserve response carries a `Date` header from the SERVER's clock, while the device
 * clock runs ahead. The refusal path is the one that must teach the client its offset, so it may never be a
 * header-less double. `headers: null` reproduces a response we cannot read a clock off at all.
 */
const route_reserve = (respond, true_now) => {
  const headers =
    true_now == null ? null : { get: (name) => (String(name).toLowerCase() === 'date' ? http_date(true_now()) : null) }
  const spy = mock(async (url) => {
    if (String(url).endsWith('/reserve')) return { ...respond(), ...(headers ? { headers } : {}) }
    throw new Error('/execute is out of scope for this suite')
  })
  globalThis.fetch = spy
  return spy
}

const challenge_timestamp = (spy) => Number(JSON.parse(calls_to(spy, '/reserve')[0][1].body).challenge.split(':')[2])

const real_fetch = globalThis.fetch
const real_now = Date.now
beforeEach(() => _reset_server_clock_for_test())
afterEach(() => {
  globalThis.fetch = real_fetch
  Date.now = real_now
})

/** One sponsored attempt on a device whose clock is `skew_ms` off. Returns the wire spy and the thrown error. */
async function attempt({ skew_ms, respond, readable_date = true }) {
  const true_now = real_now()
  Date.now = () => true_now + skew_ms
  const spy = route_reserve(respond, readable_date ? () => true_now : null)
  const error = await execute_sponsored_tx({
    wallet: make_wallet(mock(async () => ({ digest: '0xself' }))),
    address: ADDR,
    transaction: make_tx(),
    chain: CHAIN,
    sponsor_url: SPONSOR_URL,
  }).then(
    () => null,
    (thrown) => thrown
  )
  return { spy, error, true_now }
}

const stale_refusal = () => ({
  ok: false,
  status: 400,
  text: async () => refusal_body('zklogin-stale: challenge expired — retry'),
})
const ok_reserve = () => ({
  ok: true,
  json: async () => ({ reservationId: 42, sponsorAddress: '0xspon', gasCoins: [], gasBudget: 3_000_000 }),
})

describe('#2263 the challenge is stamped against the SERVER clock', () => {
  test('a +10-minute device clock still lands the challenge inside the service window', async () => {
    // First attempt: nothing measured yet, so the stamp is device time and the service refuses (today's bug).
    const first = await attempt({ skew_ms: DEVICE_SKEW_MS, respond: stale_refusal })
    expect(challenge_timestamp(first.spy) - first.true_now).toBeGreaterThanOrEqual(DEVICE_SKEW_MS)

    // That refusal carried the server's `Date` — the offset is now known, and the retry must stamp for it.
    const second = await attempt({ skew_ms: DEVICE_SKEW_MS, respond: ok_reserve })
    const age_at_server = second.true_now - challenge_timestamp(second.spy)
    expect(Math.abs(age_at_server)).toBeLessThan(CHALLENGE_TTL_MS)
    // Not merely "inside the window": within a couple of seconds of the server's own clock.
    expect(Math.abs(age_at_server)).toBeLessThan(2000)
  })

  test('an unmeasurable clock stamps device time exactly as before — the offset never blocks the flow', async () => {
    const { spy, true_now } = await attempt({
      skew_ms: DEVICE_SKEW_MS,
      respond: stale_refusal,
      readable_date: false,
    })
    expect(challenge_timestamp(spy) - true_now).toBeGreaterThanOrEqual(DEVICE_SKEW_MS)
  })
})

describe('#2263 the refusal copy names the clock when the clock is the cause', () => {
  test('a ≥2-minute measured skew gets the clock copy, with the drift in minutes', async () => {
    await attempt({ skew_ms: DEVICE_SKEW_MS, respond: stale_refusal }) // measures the offset
    const { error } = await attempt({ skew_ms: DEVICE_SKEW_MS, respond: stale_refusal })
    expect(error?.message).toBe(i18n.t('errors.sponsor_clock_skew', { minutes: 10 }))
    expect(error?.message).not.toBe(i18n.t('errors.sponsor_zklogin'))
  })

  test('ordinary drift keeps the generic verify-failure copy', async () => {
    await attempt({ skew_ms: SMALL_SKEW_MS, respond: stale_refusal })
    const { error } = await attempt({ skew_ms: SMALL_SKEW_MS, respond: stale_refusal })
    expect(error?.message).toBe(i18n.t('errors.sponsor_zklogin'))
  })
})
