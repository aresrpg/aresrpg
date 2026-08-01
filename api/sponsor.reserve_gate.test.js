// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE GATE, DRIVEN (#796). sponsor.simulate_gate.test.js proves the pure verdict; this file proves the verdict
// is actually WIRED — that every refusal arm of reserveSponsored returns before `station_reserve`, so no
// reservation exists, nothing is co-signed and no gas can be burned. The floor-2 review's finding was exactly
// this gap: the gate was unit-tested through its helper only, and a helper nobody calls protects nothing.
//
// The proof shape is the same for every arm: drive the REAL reserveSponsored, assert the machine reason on the
// REAL wire response, and assert the station fetch was NEVER called.
//
//   bun test ./sponsor.reserve_gate.test.js    (no Redis, no fullnode, no station — every door is a double)
//
// Own process on purpose (like every sibling suite): sponsor state + allowlist resolve at module load.

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { Transaction } from '@mysten/sui/transactions'
import { toBase64 } from '@mysten/sui/utils'

import release from '../packages/sdk/src/deployment/release.json' with { type: 'json' }

// ── ENV POLARITY, STATED (sponsor_state.mjs memoizes all three at module load) ──
// The refusal arms below are driven against the in-memory counters, and an in-memory counter is a per-process
// allowance — off localnet its absence refuses outright, which would make every arm below pass for the WRONG
// reason (sponsor.store_required.test.js owns that polarity). So this file declares the one network where a
// store-less process may still sponsor. `localnet` has no release.json entry, so the release derivation that
// normally fills the scope allowlist comes back empty: the allowlist is stated too, from the same checked-in id
// the PTB fixture is built from — otherwise the scope arm would swallow every other arm's refusal.
const ARES = release.networks.testnet.packages.aresrpg.latest
process.env.REDIS_URL = '' // no shared store configured → in-memory cap + reservation stash (deterministic)
process.env.VITE_NETWORK = 'localnet'
process.env.SPONSOR_ARESRPG_PACKAGES = ARES
process.env.GAS_STATION_URL = 'http://rpc-gas-pool.test:9527'
process.env.GAS_STATION_AUTH = 'test-bearer'
process.env.SPONSOR_SIMULATE_TIMEOUT_MS = '150' // keep the deadline arm fast

// ── the two doors reserveSponsored opens before the station: the chain client and the zkLogin verifier ──
// Doubled at the MODULE seam rather than through env switches on purpose: SPONSOR_DEV_BYPASS_ZKLOGIN is now a
// boot refusal on a credentialed process (see sponsor.boot_refusal.test.js), so a test may not arm it.
let next_simulation = null // a value to resolve, an Error to reject, or a function to call
let next_balance = '0'
const core = {
  getBalance: async () => ({ balance: { balance: next_balance } }),
  simulateTransaction: async () => {
    if (typeof next_simulation === 'function') return next_simulation()
    if (next_simulation instanceof Error) throw next_simulation
    return next_simulation
  },
}
mock.module('@mysten/sui/grpc', () => ({
  SuiGrpcClient: function SuiGrpcClient() {
    return { core }
  },
}))
mock.module('./zklogin_auth.mjs', () => ({ assert_zklogin_challenge: async () => {} }))

const S = await import('./sponsor.mjs')

// ── the station door: any call here means a reservation was taken, i.e. the gate LEAKED ──
let station_calls = []
const RESERVATION = {
  result: {
    sponsor_address: `0x${'5b'.repeat(32)}`,
    reservation_id: 4242,
    gas_coins: [
      { objectId: `0x${'77'.repeat(32)}`, version: '7', digest: 'ES6c9UyVEbXAZWQXUtzvyxvcCQ2FZ9BVgKPnjLXFto1p' },
    ],
  },
}
beforeEach(() => {
  station_calls = []
  next_balance = '0'
  globalThis.fetch = async (url, init) => {
    station_calls.push({ url: String(url), body: JSON.parse(init.body) })
    return { ok: true, status: 200, json: async () => RESERVATION }
  }
})

const SENDER = `0x${'a1'.repeat(32)}`
const OBJ = { objectId: `0x${'11'.repeat(32)}`, version: 5n, digest: 'ES6c9UyVEbXAZWQXUtzvyxvcCQ2FZ9BVgKPnjLXFto1p' }
const build_kind = async () => {
  const tx = new Transaction()
  tx.moveCall({ target: `${ARES}::zones::join_world`, arguments: [tx.objectRef(OBJ)] })
  return toBase64(await tx.build({ onlyTransactionKind: true }))
}
const KIND = await build_kind()

const reserve = (overrides = {}) =>
  S.reserveSponsored({ txKindBytes: KIND, sender: SENDER, challenge: 'c', signature: 's', ...overrides }).then(
    (value) => ({ value, error: null }),
    (error) => ({ value: null, error })
  )

const gas = { computationCost: '1270000', storageCost: '22359200', storageRebate: '22135608' }
const clean = { $kind: 'Transaction', Transaction: { effects: { status: { success: true }, gasUsed: gas } } }
const aborting = {
  $kind: 'FailedTransaction',
  FailedTransaction: { effects: { status: { success: false, error: 'InputObjectDeleted' }, gasUsed: gas } },
}

// The positive control. Without it every "nothing was reserved" assertion below could be passing because the
// harness itself never reaches the station — this proves the harness DOES reserve when the gate says yes.
describe('POSITIVE CONTROL — a clean simulation still reserves', () => {
  test('a clean success reserves through the station and returns the reservation', async () => {
    next_simulation = clean
    const { value, error } = await reserve()
    expect(error).toBeNull()
    expect(value.reservationId).toBe(4242)
    expect(station_calls.map((call) => call.url)).toEqual(['http://rpc-gas-pool.test:9527/v1/reserve_gas'])
    // budget = (computation + storage) × 1.5, the derived quote the station is asked to hold
    expect(station_calls[0].body.gas_budget).toBe(35443800)
  })
})

describe('EVERY refusal arm returns BEFORE the station — nothing reserved, nothing signed, zero gas', () => {
  const arms = {
    'would-abort (the chain says this PTB fails)': {
      simulation: aborting,
      reason: S.WOULD_ABORT_REASON,
      // the chain's own string rides back STRUCTURALLY, so the client never strips a prefix off the message
      chain_error: 'InputObjectDeleted',
    },
    'unreadable: effects with no status': {
      simulation: { $kind: 'Transaction', Transaction: { effects: { gasUsed: gas } } },
      reason: S.SIMULATION_UNREADABLE_REASON,
    },
    'unreadable: unknown union tag over clean-looking effects': {
      simulation: { $kind: 'Nope', Transaction: { effects: { status: { success: true }, gasUsed: gas } } },
      reason: S.SIMULATION_UNREADABLE_REASON,
    },
    'unreadable: non-boolean success': {
      simulation: { $kind: 'Transaction', Transaction: { effects: { status: { success: 'true' }, gasUsed: gas } } },
      reason: S.SIMULATION_UNREADABLE_REASON,
    },
    'infrastructure: the RPC threw': {
      simulation: new Error('grpc unavailable'),
      reason: S.SIMULATION_INFRASTRUCTURE_REASON,
    },
    'infrastructure: the RPC never answered (deadline)': {
      simulation: () => new Promise(() => {}), // never settles — the deadline must refuse it
      reason: S.SIMULATION_INFRASTRUCTURE_REASON,
    },
  }
  for (const [name, { simulation, reason, chain_error }] of Object.entries(arms))
    test(`${name} → reason "${reason}", station NEVER called`, async () => {
      next_simulation = simulation
      const { value, error } = await reserve()
      expect(value).toBeNull()
      expect(error.sponsor_reason).toBe(reason)
      const body = S.sponsor_error_response(error)
      expect(body.reason).toBe(reason)
      if (chain_error) expect(body.chain_error).toBe(chain_error)
      expect(station_calls).toEqual([]) // THE assertion: no reservation exists, so no gas can ever be burned
    })
})

// The gas half of the same gate: a simulation that IS clean but prices to nothing / to too much must refuse on
// the same side of the station. These arms were entirely uncovered — the review's finding 4.
describe('the GAS arms refuse before the station too', () => {
  const unpriceable = {
    'zero gas': { computationCost: '0', storageCost: '0', storageRebate: '0' },
    'no gasUsed block at all': undefined,
    'unreadable gas numbers': { computationCost: 'not-a-number', storageCost: '0', storageRebate: '0' },
  }
  for (const [name, gas_block] of Object.entries(unpriceable))
    test(`${name} → sponsor-unpriceable, station NEVER called`, async () => {
      next_simulation = {
        $kind: 'Transaction',
        Transaction: { effects: { status: { success: true }, gasUsed: gas_block } },
      }
      const { value, error } = await reserve()
      expect(value).toBeNull()
      expect(error.message).toMatch(/sponsor-unpriceable/)
      expect(station_calls).toEqual([])
    })

  test('a budget over the per-tx ceiling → sponsor-over-ceiling, station NEVER called', async () => {
    // ×1.5 of this gross is comfortably past PER_TX_BUDGET_CEILING_MIST
    const huge = String(S.PER_TX_BUDGET_CEILING_MIST)
    next_simulation = {
      $kind: 'Transaction',
      Transaction: { effects: { status: { success: true }, gasUsed: { computationCost: huge, storageCost: huge } } },
    }
    const { value, error } = await reserve()
    expect(value).toBeNull()
    expect(error.message).toMatch(/sponsor-over-ceiling/)
    expect(station_calls).toEqual([])
  })
})

describe('the pre-simulation rails also return before the station', () => {
  test('an oversized PTB kind is refused before it is even parsed', async () => {
    const { value, error } = await reserve({ txKindBytes: 'A'.repeat(64 * 1024 + 1) })
    expect(value).toBeNull()
    expect(error.message).toMatch(/sponsor-oversize/)
    expect(station_calls).toEqual([])
  })

  test('a funded wallet (> 0.2 SUI) self-pays — the balance rail still fires first', async () => {
    next_balance = '300000000'
    next_simulation = clean
    const { error } = await reserve()
    expect(error.message).toMatch(/self-pay-required/)
    expect(station_calls).toEqual([])
  })
})

// The two refusals that decide whether the PLAYER'S OWN SUI gets spent — the funded-wallet re-route and the
// free-tier cap — must be recognisable without reading a word of the diagnostic. Before this, both arrived
// untagged and the client recovered them by matching server-authored English, so a copy edit here would have
// silently handed a cap refusal to the client's generic arm (which self-pays).
describe('the MONEY refusals carry machine reasons on the wire, not just English', () => {
  test('funded wallet → reason "self-pay-required", station NEVER called', async () => {
    next_balance = '300000000'
    next_simulation = clean
    const { error } = await reserve()
    expect(error.sponsor_reason).toBe(S.SELF_PAY_REASON)
    expect(S.sponsor_error_response(error)).toEqual({ error: error.message, reason: 'self-pay-required' })
    expect(station_calls).toEqual([])
  })

  test('a spent-out day → reason "daily-cap", station NEVER called', async () => {
    const capped = `0x${'c9'.repeat(32)}`
    next_simulation = clean
    // The whole free budget, already booked — through the ONE door that moves the day counter. Booking IS the
    // record now: there is no separate "record a spend afterwards" call to seed a spent-out day with.
    await S.addr_daily_hold(capped, S.ADDR_DAILY_CAP_MIST)
    const { value, error } = await reserve({ sender: capped })
    expect(value).toBeNull()
    expect(error.sponsor_reason).toBe(S.DAILY_CAP_REASON)
    expect(S.sponsor_error_response(error)).toEqual({ error: error.message, reason: 'daily-cap' })
    expect(station_calls).toEqual([])
  })
})
