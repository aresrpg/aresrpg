// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// api/sponsor.mjs SHARED-STORE REQUIREMENT: with a PRODUCTION-shaped env (network=testnet) and NO shared
// store configured, sponsorship must REFUSE — honestly, and before any verification, balance read or
// simulation. Every anti-drain limit (rate window, daily cap, once-only reservation) lives in that store; an
// in-memory substitute gives each process its own full allowance, so the caps multiply by instance count while
// still reporting as enforced. A refused sponsorship is degraded UX; an unbounded one is a drained pool.
//
//   bun test api/sponsor.store_required.test.js        (no Redis, no station reachable — that's the point)
//
// Own process on purpose (like every sibling suite): sponsor state memoizes REDIS_URL and the network at
// module load, so this polarity must be set BEFORE the import below.

import { describe, expect, test } from 'bun:test'

process.env.REDIS_URL = '' // no shared store CONFIGURED
process.env.VITE_NETWORK = 'testnet' // …under a production-shaped network (the localnet carve-out cannot apply)
process.env.GAS_STATION_URL = 'http://127.0.0.1:1' // station config present: the refusal below is the STORE's
process.env.GAS_STATION_AUTH = 'test-token'

const S = await import('./sponsor.mjs')

const SENDER = `0x${'1'.repeat(64)}`
// The machine reason spelled out, never read off the module under test — a missing export must FAIL here.
const REASON = 'shared-store-unavailable'

/** Run a door and hand back the refusal it threw (never a resolved value — that would be the bug). */
const refusal = async (door) => {
  try {
    await door()
  } catch (error) {
    return error
  }
  throw new Error('the door RESOLVED — a sponsorship was granted with no shared store to bound it')
}

describe('no shared store + production-shaped env ⇒ FAIL CLOSED', () => {
  test('the store is reported unavailable, not silently substituted', async () => {
    expect(S.SHARED_STORE_REASON).toBe(REASON)
    expect(await S.shared_store_ready()).toBe(false)
  })

  test('reserve refuses with the machine reason, before any zkLogin/balance/simulation work', async () => {
    const error = await refusal(() =>
      S.reserveSponsored({ txKindBytes: 'AAAA', sender: SENDER, challenge: 'c', signature: 's' })
    )
    expect(error.sponsor_reason).toBe(REASON)
    expect(error.message).toMatch(/refusing to sponsor \(fail-closed\)/)
  })

  test('execute refuses the same way — a hold it cannot settle is never executed', async () => {
    const error = await refusal(() => S.executeSponsored({ reservationId: 'r1', txBytes: 'AAAA', userSig: 'sig' }))
    expect(error.sponsor_reason).toBe(REASON)
  })

  test('the HTTP surface answers 503 with the honest reason — never a misleading 429', async () => {
    const response = await S.sponsor_fetch(
      new Request('http://sponsor.test/api/sponsor/reserve', {
        method: 'POST',
        body: JSON.stringify({ txKindBytes: 'AAAA', sender: SENDER }),
      })
    )
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.reason).toBe(REASON)
    expect(body.error).not.toMatch(/rate limit/i)
  })

  test('the per-instance rate windows are gone: no store ⇒ the very first check refuses', async () => {
    expect(await S.rate_limited('10.0.0.7')).toBe(true)
    expect(await S.addr_rate_limited(SENDER)).toBe(true)
  })

  test('a reservation that cannot be parked where every instance sees it is not handed out', async () => {
    expect(await S.stash_reservation('r-nostore', { sender: SENDER })).toBe(false)
  })

  test('the refusal is counted under its own name, never folded into another', () => {
    expect(S.sponsor_stats().refused.store).toBeGreaterThan(0)
  })
})
