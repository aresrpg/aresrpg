// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #2262 — THE SPONSORED CREATE IS BILLED PER LEG. The create's ~seconds were REPORTED, never measured: the
// sponsored door's own per-leg numbers were printed behind `?txtiming=1` and thrown away, and #1862's line
// collapsed the whole flow into one `tx+wait` total, so "which leg is fat" was a guess.
//
// Driven over the REAL sponsored door (test/tx/sponsor_door_harness.js — the same scripted wire the money
// suites use), so this proves the DOOR hands its bill to the create, not that a recorder can add numbers.
//
//   bun test ./test/core/create_timing.test.js
//
// RED BEFORE THE FIX (measured by reverting src/tx/index.ts + src/roster + src/core/create_timing.js):
//   ✗ prepare/reserve/sign/execute are null — the door measures its legs and drops them on the floor
//   ✗ the emitted line reads `prepare ?ms · reserve ?ms · …`, and the legs cannot sum to the total
//
// THE POINT IS THE FATTEST LEG: the slow leg in the script must be the largest number in the line. An
// instrument that cannot rank its legs cannot target a fix.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  CREATE_TIMING_LEGS,
  cancel_create_timing,
  create_timing_character_id,
  finish_create_timing,
  mark_create_indexer_visible,
  mark_create_receipt,
  start_create_timing,
} from '../../src/core/create_timing.js'
import { _reset_log_for_test, get_log_buffer } from '../../src/core/log.js'
import { execute_sponsored_tx } from '../../src/tx/index'
import { ADDR, CHAIN, SPONSOR_URL, make_tx, make_wallet, route_sponsor } from '../tx/sponsor_door_harness.js'

const CHARACTER = '0x' + '1a'.repeat(32)
const DIGEST = 'ES6c9UyVEbXAZWQXUtzvyxvcCQ2FZ9BVgKPnjLXFto1p'
const SLOW_EXECUTE_MS = 25

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const executed_body = () => ({
  digest: DIGEST,
  effects: { transactionDigest: DIGEST, status: { status: 'success' } },
})

/** The create's own transaction, driven through the REAL door with a deliberately slow /execute leg. */
async function drive_sponsored_create(transaction) {
  route_sponsor({
    execute: async () => {
      await sleep(SLOW_EXECUTE_MS) // the station submits AND waits for finality before it answers
      return { ok: true, json: async () => executed_body() }
    },
  })
  return execute_sponsored_tx({
    wallet: make_wallet(async () => ({ digest: 'SELF_PAY' })),
    address: ADDR,
    transaction,
    chain: CHAIN,
    sponsor_url: SPONSOR_URL,
  })
}

const create_perf_lines = () => get_log_buffer().filter(({ ns }) => ns === 'create-perf')

const real_fetch = globalThis.fetch
beforeEach(() => {
  _reset_log_for_test()
  cancel_create_timing()
})
afterEach(() => {
  globalThis.fetch = real_fetch
  cancel_create_timing()
})

describe('#2262 — one sponsored create, one seven-leg bill', () => {
  test('every leg of a driven create is measured, they sum to the total, and ONE line carries them', async () => {
    const transaction = make_tx()
    start_create_timing(transaction, 'test')

    await drive_sponsored_create(transaction)
    mark_create_receipt(transaction, CHARACTER, 'certified-effects')
    expect(create_timing_character_id()).toBe(CHARACTER)
    await sleep(5) // the read layer catching up
    mark_create_indexer_visible(CHARACTER)
    const durations = finish_create_timing(CHARACTER)

    // (1) EVERY leg present — a null leg is the failure this row exists to kill.
    for (const leg of CREATE_TIMING_LEGS) expect(typeof durations[leg]).toBe('number')
    // (2) The legs ARE the decomposition of the wall clock: total is measured independently, so a leg that
    //     silently swallowed another's time cannot pass. 2ms covers the door's un-billed sync setup.
    const sum = CREATE_TIMING_LEGS.reduce((total, leg) => total + durations[leg], 0)
    expect(Math.abs(sum - durations.total)).toBeLessThanOrEqual(2)
    // (3) THE PURPOSE: the fattest leg is readable. The scripted slow leg must rank first.
    const [fattest] = [...CREATE_TIMING_LEGS].sort((a, b) => durations[b] - durations[a])
    expect(fattest).toBe('execute')
    expect(durations.execute).toBeGreaterThanOrEqual(SLOW_EXECUTE_MS - 1)
    // (4) ONE line per create, through the one log home, naming every leg and no unmeasured gap.
    const lines = create_perf_lines()
    expect(lines).toHaveLength(1)
    for (const leg of CREATE_TIMING_LEGS) expect(lines[0].message).toContain(`${leg} `)
    expect(lines[0].message).not.toContain('?ms')
    expect(lines[0].message).toContain('receipt-source certified-effects') // #1862's fact rides on the same line
    expect(create_timing_character_id()).toBeNull() // a closed trace owns nothing
  })

  test('an unrelated sponsored transaction cannot be billed to the create', async () => {
    const transaction = make_tx()
    start_create_timing(transaction, 'test')

    await drive_sponsored_create(make_tx()) // some other sponsored tx, same session

    mark_create_receipt(transaction, CHARACTER, 'certified-effects')
    mark_create_indexer_visible(CHARACTER)
    const durations = finish_create_timing(CHARACTER)
    // The other transaction's legs are an honest gap, never numbers borrowed from a different flow — its 25ms
    // /execute cannot show up here. (`prepare`, the first unclosed leg, honestly owns the unattributed elapsed.)
    for (const leg of ['reserve', 'sign', 'execute']) expect(durations[leg]).toBeNull()
    expect(create_perf_lines()[0].message).toContain('execute ?ms')
  })

  test('an unrelated roster load can neither stage nor close a live create trace', () => {
    const transaction = make_tx()
    start_create_timing(transaction, 'test')
    mark_create_receipt(transaction, CHARACTER, 'certified-effects')

    mark_create_indexer_visible('0xsomeone-else')
    expect(finish_create_timing('0xsomeone-else')).toBeNull()
    expect(create_timing_character_id()).toBe(CHARACTER) // still mine, still open
    expect(create_perf_lines()).toHaveLength(0)
    expect(finish_create_timing(CHARACTER)).not.toBeNull()
  })

  test('a refused create closes nothing — no line, no trace left armed for the next press', () => {
    const transaction = make_tx()
    start_create_timing(transaction, 'test')
    mark_create_receipt(transaction, CHARACTER, 'certified-effects')

    cancel_create_timing()

    expect(finish_create_timing(CHARACTER)).toBeNull()
    expect(create_perf_lines()).toHaveLength(0)
  })
})
