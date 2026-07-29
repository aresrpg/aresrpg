// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// api/sponsor.mjs NO-STORE mode (Vercel/Node class): when NO Redis store is CONFIGURED (here: explicit
// REDIS_URL='' — the same `_redis === null` state Vercel/Node reaches with `typeof Bun === 'undefined'`),
// the rate windows must fall back to PER-INSTANCE IN-MEMORY fixed windows and STILL ENFORCE their limits —
// NOT refuse-all (the lead-review finding: fail-closed-on-null made every Vercel POST a 429), and NOT
// fail-open. The daily cap's in-memory shadow is the primary counter in this mode (same per-instance caveat).
//
//   bun test api/sponsor.nostore.test.js        (no Redis needed — that's the point)
//
// Own process on purpose (like sponsor.test.js / sponsor.failclosed.test.js): sponsor state memoizes
// REDIS_URL + its client at module load, so the no-store state must be set BEFORE the import below.

import { describe, expect, test } from 'bun:test'

process.env.REDIS_URL = '' // explicit empty = "no store configured" (the ?? seam; unset under Bun would default to localhost)
const S = await import('./sponsor.mjs')

const RL_MAX = Number(process.env.SPONSOR_RL_MAX || 5)
const ADDR_RL_MAX = Number(process.env.SPONSOR_ADDR_MAX || 60)

describe('NO store configured (Vercel/Node class) ⇒ in-memory per-instance windows, enforced — never refuse-all', () => {
  test(`per-IP: allows ${RL_MAX} then blocks (in-memory window, not a 429-everything)`, async () => {
    const ip = '10.0.0.1'
    for (let i = 0; i < RL_MAX; i++) expect(await S.rate_limited(ip)).toBe(false) // the Vercel-dead bug returned true here
    expect(await S.rate_limited(ip)).toBe(true) // …but the window still bites at RL_MAX
  })
  test(`per-address: allows ${ADDR_RL_MAX} then blocks (in-memory window)`, async () => {
    const addr = '0xNoStore'
    for (let i = 0; i < ADDR_RL_MAX; i++) expect(await S.addr_rate_limited(addr)).toBe(false)
    expect(await S.addr_rate_limited(addr)).toBe(true)
  })
  test('per-address DAILY cap: the in-memory shadow is the primary counter and still enforces', async () => {
    const addr = '0xNoStoreDaily'
    const tiny = await S.addr_daily_hold(addr, 100n) // fresh address, tiny charge → allowed
    expect(tiny).not.toBeNull()
    await S.release_daily_hold(tiny, addr) // …and giving it back leaves the whole budget available
    expect(await S.addr_daily_hold(addr, S.ADDR_DAILY_CAP_MIST)).not.toBeNull() // fill it (in-memory)
    expect(await S.addr_daily_hold(addr, 1n)).toBeNull() // 1 mist over remaining → refuse
  })
})
