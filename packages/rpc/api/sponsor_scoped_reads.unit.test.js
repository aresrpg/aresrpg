// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2270 — THE ALLOWANCE READS THE ENFORCEMENT'S OWN STORE. The sponsor service writes its money
// counters (`sponsor:cap:addr_daily_mist`, `sponsor:spent:{day}:{addr}`) to the Redis IT owns. This
// API's other reads follow the indexer cache, which is flipped blue/green — and after a flip the
// endpoint was asking a store that had never seen a sponsor key, so /v1/sponsor/remaining refused
// (503 `sponsor_cap_unavailable`) for every player while the sponsor was enforcing a real allowance.
//
// RED-FIRST, for that exact reason: the discriminator is TWO stores. The sponsor keys exist on the
// scoped client and NOT on the indexer client, so a handler reading the indexer connection can only
// answer 503, and one reading the scoped connection answers the real remaining. A handler with a
// single connection cannot pass both this and the control below.
//
// Offline by construction (fake clients — the file's convention next door in
// sponsor_remaining_cap.unit.test.js); sponsor_remaining.test.js stays the real-Redis oracle.

import { describe, expect, test } from 'bun:test'

import { create_reads, get_str, REDIS_URL, redis, sponsor_reads, sponsor_redis, SPONSOR_REDIS_URL } from './redis.js'
import { handle_sponsor_remaining } from './views.js'

const ADDR = `0x${'5e1'.padStart(64, '0')}`
const CAP_KEY = 'sponsor:cap:addr_daily_mist'
const SPENT_KEY = `sponsor:spent:${new Date().toISOString().slice(0, 10)}:${ADDR.toLowerCase()}`
const PUBLISHED_CAP = 5_000_000_000n
const SPENT = 2_000_000n

const P = (query) => new URLSearchParams(query)

// A fake RedisClient: `send` is the ONE seam create_reads binds to, so a bundle built over this is
// the real helper code reading a store we fully control.
const fake_client = (entries) => {
  const calls = []
  return {
    calls,
    send: async (command, args) => {
      calls.push([command, ...args])
      return command === 'GET' ? (entries.get(args[0]) ?? null) : null
    },
  }
}
const sponsor_store = () =>
  fake_client(
    new Map([
      [CAP_KEY, PUBLISHED_CAP.toString()],
      [SPENT_KEY, SPENT.toString()],
    ])
  )
// The flipped indexer cache: alive and answering, it has simply never held a sponsor key.
const flipped_indexer_cache = () => fake_client(new Map())

describe('/v1/sponsor/remaining reads the sponsor store, not the indexer cache (#2270)', () => {
  test('sponsor keys on the SCOPED store → the real remaining is served', async () => {
    const scoped = sponsor_store()
    const indexer = flipped_indexer_cache()

    const { status, data } = await handle_sponsor_remaining(P(`address=${ADDR}`), create_reads(scoped))

    expect(status).toBe(200)
    expect(data.allowance_mist).toBe(PUBLISHED_CAP.toString())
    expect(data.spent_mist).toBe(SPENT.toString())
    expect(data.remaining_mist).toBe((PUBLISHED_CAP - SPENT).toString())
    expect(scoped.calls).toEqual([
      ['GET', CAP_KEY],
      ['GET', SPENT_KEY],
    ])
    expect(indexer.calls).toEqual([]) // the flipped cache is never asked for money state
  })

  // THE CONTROL — the honest refusal survives the fix. It fires when the store the endpoint asks
  // cannot answer, which is precisely what the indexer cache does after a flip.
  test('a store without the sponsor keys still refuses out loud (503, uncached, no number)', async () => {
    const { status, headers, data } = await handle_sponsor_remaining(
      P(`address=${ADDR}`),
      create_reads(flipped_indexer_cache())
    )

    expect(status).toBe(503)
    expect(data.error).toBe('sponsor_cap_unavailable')
    expect(data.allowance_mist).toBeUndefined()
    expect(headers['cache-control']).toBe('no-store')
  })

  test('input validation still short-circuits before either store is touched', async () => {
    const scoped = sponsor_store()
    const reads = create_reads(scoped)
    expect((await handle_sponsor_remaining(P(''), reads)).status).toBe(400)
    expect((await handle_sponsor_remaining(P('address=not-an-address'), reads)).status).toBe(400)
    expect(scoped.calls).toEqual([])
  })
})

describe('the scoped connection', () => {
  test('unset SPONSOR_REDIS_URL means the SAME instance — one client, one bundle, no config churn', () => {
    // This suite runs with SPONSOR_REDIS_URL unset (the single-instance deploy).
    expect(process.env.SPONSOR_REDIS_URL).toBeUndefined()
    expect(SPONSOR_REDIS_URL).toBe(REDIS_URL)
    expect(sponsor_redis).toBe(redis) // no second connection is opened for nothing
    expect(sponsor_reads.get_str).toBe(get_str) // and no second helper bundle either
  })

  // THE RED ONE. Everything above drives an INJECTED bundle, which the endpoint already accepted —
  // the bug was in what it reads with NO injection, in production. The env is read at module load,
  // so a split store only exists in a fresh process: this drives the real endpoint there, with both
  // clients' `send` stubbed (the flipped indexer cache holds nothing, the sponsor store holds the
  // money keys) and NOTHING passed as `reads`. On the unfixed handler there is no second client at
  // all, so it asks the flipped cache and answers 503 — the exact production symptom of #2270.
  test('with the stores split, the endpoint ITSELF asks the sponsor store (no injection)', () => {
    const probe = `
      const R = await import('./redis.js')
      const { handle_sponsor_remaining } = await import('./views.js')
      const CAP_KEY = ${JSON.stringify(CAP_KEY)}
      const SPENT_KEY = ${JSON.stringify(SPENT_KEY)}
      const sponsor_state = { [CAP_KEY]: ${JSON.stringify(PUBLISHED_CAP.toString())}, [SPENT_KEY]: ${JSON.stringify(SPENT.toString())} }
      const asked = { indexer: [], sponsor: [] }
      R.redis.send = async (_command, args) => { asked.indexer.push(args[0]); return null }
      const scoped = R.sponsor_redis
      if (scoped && scoped !== R.redis)
        scoped.send = async (_command, args) => { asked.sponsor.push(args[0]); return sponsor_state[args[0]] ?? null }
      const { status, data } = await handle_sponsor_remaining(new URLSearchParams('address=' + ${JSON.stringify(ADDR)}))
      console.log(JSON.stringify({ status, remaining_mist: data.remaining_mist ?? null, asked }))`

    const child = Bun.spawnSync({
      cmd: [process.execPath, '-e', probe],
      cwd: import.meta.dir,
      env: { ...process.env, REDIS_URL: 'redis://127.0.0.1:6399', SPONSOR_REDIS_URL: 'redis://127.0.0.1:6400' },
      stderr: 'pipe',
    })

    expect(child.stderr.toString()).toBe('')
    expect(JSON.parse(child.stdout.toString())).toEqual({
      status: 200,
      remaining_mist: (PUBLISHED_CAP - SPENT).toString(),
      asked: { indexer: [], sponsor: [CAP_KEY, SPENT_KEY] },
    })
  })
})
