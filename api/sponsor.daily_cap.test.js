// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE DAILY CAP, DRIVEN. sponsor.reserve_gate.test.js proves the cap refusal returns before the station; this
// file proves the cap COUNTS correctly — that N reserves fired together cannot each be measured against the same
// pre-burst total. The counter is booked at reserve and settled to the executed charge at execute, so the
// properties are: a burst is bounded, a reservation that dies early gives its budget back, an abandoned one gives
// it back at its expiry, and the day's ledger ends up at what the chain actually charged.
//
//   bun test ./sponsor.daily_cap.test.js    (no Redis, no fullnode, no station — every door is a double)
//
// Own process on purpose (like every sibling suite): sponsor state + allowlist resolve at module load.
//
// RED BEFORE THE FIX: the cap was read at reserve and written at execute, so all four parallel reserves passed
// (4 station calls, 4 reservations, ~1.2 SUI of budget against a 1 SUI/day cap).

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { Transaction } from '@mysten/sui/transactions'
import { toBase64, fromBase64 } from '@mysten/sui/utils'

import release from '../packages/sdk/src/deployment/release.json' with { type: 'json' }

process.env.REDIS_URL = '' // in-memory daily cap + reservation stash (deterministic, no store)
process.env.GAS_STATION_URL = 'http://rpc-gas-pool.test:9527'
process.env.GAS_STATION_AUTH = 'test-bearer'
process.env.SPONSOR_RESERVE_TTL_MS = '120' // the hold/stash lifetime — short enough to drive the expiry paths

let next_simulation = null
let next_balance = '0'
const core = {
  getBalance: async () => ({ balance: { balance: next_balance } }),
  simulateTransaction: async () => next_simulation,
}
mock.module('@mysten/sui/grpc', () => ({
  SuiGrpcClient: function SuiGrpcClient() {
    return { core }
  },
}))
mock.module('./zklogin_auth.mjs', () => ({ assert_zklogin_challenge: async () => {} }))

const S = await import('./sponsor.mjs')

// ── the station door ──────────────────────────────────────────────────────────────────────────────────────
let station_calls = []
let next_station = null // an Error to throw, or null for the ordinary reservation
let last_reservation_id = 0
beforeEach(() => {
  station_calls = []
  next_station = null
  next_balance = '0'
  globalThis.fetch = async (url, init) => {
    station_calls.push({ url: String(url), body: JSON.parse(init.body) })
    if (next_station instanceof Error) throw next_station
    if (String(url).endsWith('/v1/execute_tx')) return { ok: true, status: 200, json: async () => execute_answer }
    last_reservation_id += 1
    return {
      ok: true,
      status: 200,
      json: async () => ({
        result: { sponsor_address: SPONSOR, reservation_id: last_reservation_id, gas_coins: [GAS_COIN] },
      }),
    }
  }
})

const ARES = release.networks.testnet.packages.aresrpg.latest
const DIGEST = 'ES6c9UyVEbXAZWQXUtzvyxvcCQ2FZ9BVgKPnjLXFto1p'
const SPONSOR = `0x${'5b'.repeat(32)}`
const GAS_COIN = { objectId: `0x${'77'.repeat(32)}`, version: '7', digest: DIGEST }
const OBJ = { objectId: `0x${'11'.repeat(32)}`, version: 5n, digest: DIGEST }
const sender_at = (n) => `0x${n.repeat(32)}`

const build_kind = async () => {
  const tx = new Transaction()
  tx.moveCall({ target: `${ARES}::zones::join_world`, arguments: [tx.objectRef(OBJ)] })
  return toBase64(await tx.build({ onlyTransactionKind: true }))
}
const KIND = await build_kind()
/** The full tx a client builds from a reservation — what /execute validates against the stash. */
const build_full_tx = async ({ sender, budget, price = 1000 }) => {
  const tx = Transaction.fromKind(fromBase64(KIND))
  tx.setSender(sender)
  tx.setGasOwner(SPONSOR)
  tx.setGasPayment([GAS_COIN])
  tx.setGasBudget(Number(budget))
  tx.setGasPrice(price)
  return toBase64(await tx.build())
}
const SENDER_EXEC = sender_at('e7')

const reserve = (sender) =>
  S.reserveSponsored({ txKindBytes: KIND, sender, challenge: 'c', signature: 's' }).then(
    (value) => ({ value, error: null }),
    (error) => ({ value: null, error })
  )

// (computation + storage) × 1.5 = 0.3 SUI — exactly the per-tx ceiling, so THREE fit under the 1 SUI/day cap
// and the fourth cannot. Nothing here changes a cap value; the numbers are chosen to land on the real ones.
const GROSS_PER_TX = 200_000_000n
const BUDGET_PER_TX = (GROSS_PER_TX * 3n) / 2n
const clean = {
  $kind: 'Transaction',
  Transaction: {
    effects: {
      status: { success: true },
      gasUsed: { computationCost: String(GROSS_PER_TX), storageCost: '0', storageRebate: '0' },
    },
  },
}
let execute_answer = null
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

describe('a pipelined burst cannot overshoot the cap — the budget is booked at RESERVE', () => {
  test('four parallel reserves against a 1 SUI cap: three reserve, the fourth REFUSES', async () => {
    next_simulation = clean
    const sender = sender_at('b1')
    expect(S.ADDR_DAILY_CAP_MIST / BUDGET_PER_TX).toBe(3n) // the arithmetic this test rides on

    const results = await Promise.all([reserve(sender), reserve(sender), reserve(sender), reserve(sender)])

    const granted = results.filter((result) => result.value != null)
    const refused = results.filter((result) => result.error != null)
    expect(granted).toHaveLength(3)
    expect(refused).toHaveLength(1)
    expect(S.DAILY_CAP_REASON).toBe('daily-cap') // the machine reason exists, so the next line cannot pass vacuously
    expect(refused[0].error.sponsor_reason).toBe(S.DAILY_CAP_REASON)
    // THE assertion: the station was asked for exactly three reservations, never four.
    expect(station_calls).toHaveLength(3)
    expect(await S.addr_daily_spent(sender)).toBe(3n * BUDGET_PER_TX)
  })

  test('a sequential fourth reserve refuses too (the burst is not a special case)', async () => {
    next_simulation = clean
    const sender = sender_at('b2')
    for (let n = 0; n < 3; n += 1) expect((await reserve(sender)).error).toBeNull()

    const { value, error } = await reserve(sender)

    expect(value).toBeNull()
    expect(error.sponsor_reason).toBe(S.DAILY_CAP_REASON)
    expect(station_calls).toHaveLength(3)
  })
})

describe('a hold is released whenever the reservation it belongs to ends without a charge', () => {
  test('the station refuses the reservation → the budget goes straight back to the cap', async () => {
    next_simulation = clean
    const sender = sender_at('b3')
    next_station = new Error('ECONNREFUSED')

    const { error } = await reserve(sender)

    expect(error.message).toMatch(/sponsor-station-down/)
    expect(await S.addr_daily_spent(sender)).toBe(0n) // nothing reserved ⇒ nothing owed
  })

  test('an ABANDONED reservation gives its budget back at expiry (never a day-long lockout)', async () => {
    next_simulation = clean
    const sender = sender_at('b4')
    for (let n = 0; n < 3; n += 1) await reserve(sender)
    expect((await reserve(sender)).error.sponsor_reason).toBe(S.DAILY_CAP_REASON) // capped while they are live

    await sleep(150) // past SPONSOR_RESERVE_TTL_MS — the client never came back to /execute

    const { value } = await reserve(sender) // the next hold sweeps the lapsed ones first
    expect(value).not.toBeNull()
    expect(await S.addr_daily_spent(sender)).toBe(BUDGET_PER_TX) // only the fresh hold is booked
  })
})

describe('execute settles the hold to what the chain actually charged', () => {
  test('a cheap execution frees the difference between the reserved budget and the real charge', async () => {
    next_simulation = clean
    const sender = SENDER_EXEC
    const { value } = await reserve(sender)
    expect(await S.addr_daily_spent(sender)).toBe(BUDGET_PER_TX) // the whole budget, while it is in flight

    const gas_used = { computationCost: '1270000', storageCost: '2000000', storageRebate: '1000000' }
    execute_answer = { effects: { transactionDigest: DIGEST, status: { status: 'success' }, gasUsed: gas_used } }
    await S.executeSponsored({
      reservationId: value.reservationId,
      txBytes: await build_full_tx({ sender, budget: value.gasBudget }),
      userSig: 'usersig',
    })

    // the ledger ends at the EXECUTED charge — the reserve-time over-estimate is given back, not kept
    expect(await S.addr_daily_spent(sender)).toBe(S.real_charge_mist(gas_used))
  })

  test('a MISMATCHED tx at execute charges nothing and gives the whole hold back', async () => {
    next_simulation = clean
    const sender = sender_at('e8')
    const { value } = await reserve(sender)
    expect(await S.addr_daily_spent(sender)).toBe(BUDGET_PER_TX)

    // a tx built against a RAISED budget — the last policy gate refuses it before the station is called
    await expect(
      S.executeSponsored({
        reservationId: value.reservationId,
        txBytes: await build_full_tx({ sender, budget: 9_000_000 }),
        userSig: 'usersig',
      })
    ).rejects.toThrow(/sponsor-tx-mismatch/)

    expect(await S.addr_daily_spent(sender)).toBe(0n)
  })
})

// The reservation's own TTL was pinned by no test: the mechanism (Redis `SET … PX`, the in-memory expiry
// comparison) read correctly and nothing exercised it, so an expiry that silently stopped expiring — or one that
// expired everything — would have been invisible. It is the tooth behind "a reservation is a 90-second promise".
describe('a reservation EXPIRES — an execute after its window is as unknown as a foreign one', () => {
  test('an expired reservation is refused, and the station is never called', async () => {
    next_simulation = clean
    const sender = sender_at('e9')
    const { value } = await reserve(sender)
    const txBytes = await build_full_tx({ sender, budget: value.gasBudget })
    station_calls.length = 0

    await sleep(150) // past SPONSOR_RESERVE_TTL_MS

    await expect(
      S.executeSponsored({ reservationId: value.reservationId, txBytes, userSig: 'usersig' })
    ).rejects.toThrow(/sponsor-reservation-unknown/)
    expect(station_calls).toEqual([]) // nothing was submitted against a lapsed reservation
  })

  test('POSITIVE CONTROL — the same reservation executed INSIDE its window is accepted', async () => {
    next_simulation = clean
    const sender = sender_at('ea')
    const { value } = await reserve(sender)
    execute_answer = {
      effects: {
        transactionDigest: DIGEST,
        status: { status: 'success' },
        gasUsed: { computationCost: '1270000', storageCost: '0', storageRebate: '0' },
      },
    }

    const out = await S.executeSponsored({
      reservationId: value.reservationId,
      txBytes: await build_full_tx({ sender, budget: value.gasBudget }),
      userSig: 'usersig',
    })

    expect(out.digest).toBe(DIGEST)
  })
})
