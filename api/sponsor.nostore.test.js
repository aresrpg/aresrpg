// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// api/sponsor.mjs NO-STORE mode, LOCALNET ONLY. A shared store is what makes the anti-drain counters LIMITS
// rather than per-process allowances, so off localnet its absence refuses outright (sponsor.store_required.test.js
// owns that polarity). Localnet — a throwaway chain on one process, the state no production config can reach —
// keeps the in-memory fixed windows, and this file proves they still ENFORCE there: an in-memory counter that
// forgot to bite would be fail-open, which is not a legal state anywhere.
//
//   bun test api/sponsor.nostore.test.js        (no Redis needed — that's the point)
//
// Own process on purpose (like sponsor.test.js / sponsor.failclosed.test.js): sponsor state memoizes
// REDIS_URL + the network at module load, so the no-store state must be set BEFORE the import below.

import { describe, expect, test } from 'bun:test'

process.env.REDIS_URL = '' // explicit empty = "no store configured" (the ?? seam; unset under Bun would default to localhost)
process.env.VITE_NETWORK = 'localnet' // the ONLY network where a store-less process may still sponsor
const S = await import('./sponsor.mjs')

const RL_MAX = Number(process.env.SPONSOR_RL_MAX || 30)
const ADDR_RL_MAX = Number(process.env.SPONSOR_ADDR_MAX || 60)

describe('LOCALNET with no store ⇒ in-memory per-instance windows, enforced — never fail-open, never refuse-all', () => {
  test('the localnet carve-out is what keeps the doors open here', async () => {
    expect(await S.shared_store_ready()).toBe(true)
  })
  test(`per-IP: allows ${RL_MAX} then blocks (in-memory window, not a 429-everything)`, async () => {
    const ip = '10.0.0.1'
    for (let i = 0; i < RL_MAX; i++) expect(await S.rate_limited(ip)).toBe(false)
    expect(await S.rate_limited(ip)).toBe(true) // …the window still bites at RL_MAX
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
  test('a reservation may be parked in memory here — one process IS the whole deployment', async () => {
    expect(await S.stash_reservation('r-localnet', { sender: '0xNoStore' })).toBe(true)
  })
})
