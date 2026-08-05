// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2197 — THE ALLOWANCE BAR CANNOT LIE. The per-address daily sponsor cap has exactly one home: the
// sponsor service's own env, which it enforces. This endpoint renders the same number for the player.
// It used to declare that number a SECOND time from an env of its own, so a deploy that moved one half
// (the seat-ruled 1 → 5 SUI testnet raise is the recorded instance) left the other half rendering a
// figure nobody enforced — in either direction: a bar promising allowance the sponsor refuses, or one
// hiding allowance the player actually has.
//
// RED-FIRST, for the reported REASON: every test below drives the handler with a published cap that is
// deliberately NOT the retired env default (1 SUI), so a handler reading any env or literal answers
// with its own number and fails. Green means one thing only — the allowance served IS the value the
// sponsor published. Offline by construction (injected reads, the file's own convention next door in
// names_view.unit.test.js); sponsor_remaining.test.js stays the real-Redis integration oracle.

import { describe, expect, mock, test } from 'bun:test'

import { handle_sponsor_remaining } from './views.js'

const ADDR = `0x${'5e1'.padStart(64, '0')}`
const CAP_KEY = 'sponsor:cap:addr_daily_mist'
const UTC_DAY = new Date().toISOString().slice(0, 10)
const SPENT_KEY = `sponsor:spent:${UTC_DAY}:${ADDR.toLowerCase()}`
// 5 SUI — the raised testnet cap, and pointedly NOT the 1-SUI literal the retired env defaulted to.
const PUBLISHED_CAP = 5_000_000_000n
const RETIRED_ENV_DEFAULT = '1000000000'

const P = (query) => new URLSearchParams(query)
const reads = (entries) => ({ get_str: mock(async (key) => entries.get(key) ?? null) })
const store = (cap, spent = null) => reads(new Map([[CAP_KEY, cap], ...(spent == null ? [] : [[SPENT_KEY, spent]])]))

describe('/v1/sponsor/remaining derives the cap from the sponsor, never from its own config', () => {
  test('the allowance served is the PUBLISHED cap (not the retired 1-SUI env default)', async () => {
    const sponsor_reads = store(PUBLISHED_CAP.toString())
    const { status, data } = await handle_sponsor_remaining(P(`address=${ADDR}`), sponsor_reads)

    expect(status).toBe(200)
    expect(data.allowance_mist).toBe(PUBLISHED_CAP.toString())
    // The discriminator: an endpoint still reading a cap of its own would answer 1 SUI here.
    expect(data.allowance_mist).not.toBe(RETIRED_ENV_DEFAULT)
    expect(sponsor_reads.get_str).toHaveBeenCalledWith(CAP_KEY)
  })

  test('a cap raise on the sponsor side reaches the endpoint with no redeploy of this service', async () => {
    const before = await handle_sponsor_remaining(P(`address=${ADDR}`), store('1000000000'))
    const after = await handle_sponsor_remaining(P(`address=${ADDR}`), store('5000000000'))
    // Same process, same config, same code — only the published value moved. That IS the DoD.
    expect(before.data.allowance_mist).toBe('1000000000')
    expect(after.data.allowance_mist).toBe('5000000000')
  })

  test('remaining is published cap − spent, off the counter the sponsor INCRBYs', async () => {
    const sponsor_reads = store(PUBLISHED_CAP.toString(), '2000000')
    const { data } = await handle_sponsor_remaining(P(`address=${ADDR}`), sponsor_reads)

    expect(data.spent_mist).toBe('2000000')
    expect(data.remaining_mist).toBe((PUBLISHED_CAP - 2_000_000n).toString())
    expect(sponsor_reads.get_str).toHaveBeenCalledWith(SPENT_KEY)
  })

  test('spend past the published cap clamps remaining to 0, never negative', async () => {
    const { data } = await handle_sponsor_remaining(
      P(`address=${ADDR}`),
      store(PUBLISHED_CAP.toString(), (PUBLISHED_CAP + 7n).toString())
    )
    expect(data.remaining_mist).toBe('0')
  })

  test('address case does not matter — the counter key is the sponsor’s lowercase shape', async () => {
    const sponsor_reads = store(PUBLISHED_CAP.toString(), '3000000')
    const upper = `0x${ADDR.slice(2).toUpperCase()}`
    const { data } = await handle_sponsor_remaining(P(`address=${upper}`), sponsor_reads)
    expect(data.spent_mist).toBe('3000000')
  })

  // ── The instrument refuses rather than invents (instruments THROW, never coerce) ──────────────────
  test('no published cap → 503, uncached, and NO allowance number at all', async () => {
    const { status, headers, data } = await handle_sponsor_remaining(P(`address=${ADDR}`), reads(new Map()))
    expect(status).toBe(503)
    expect(data.error).toBe('sponsor_cap_unavailable')
    expect(data.allowance_mist).toBeUndefined() // a fallback literal here is the whole bug
    expect(headers['cache-control']).toBe('no-store') // never cache absence — the next boot republishes
  })

  test('a published cap that is not a MIST integer is refused, not coerced', async () => {
    for (const garbage of ['', 'five sui', '5.0', '-1', '0x5']) {
      const { status, data } = await handle_sponsor_remaining(P(`address=${ADDR}`), store(garbage))
      expect(status).toBe(503)
      expect(data.error).toBe('sponsor_cap_unavailable')
    }
  })

  test('a store that throws surfaces (a reported 500), never a confident allowance', async () => {
    const exploding = {
      get_str: mock(async () => {
        throw new Error('redis down')
      }),
    }
    await expect(handle_sponsor_remaining(P(`address=${ADDR}`), exploding)).rejects.toThrow('redis down')
  })

  test('input validation still short-circuits before any store read', async () => {
    const sponsor_reads = store(PUBLISHED_CAP.toString())
    expect((await handle_sponsor_remaining(P(''), sponsor_reads)).status).toBe(400)
    expect((await handle_sponsor_remaining(P('address=not-an-address'), sponsor_reads)).status).toBe(400)
    expect(sponsor_reads.get_str).not.toHaveBeenCalled()
  })
})
