// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE JOIN, PINNED (#1853). reserveSponsored reads the zkLogin challenge and the sender's balance in PARALLEL,
// but EVALUATES them in FIXED ORDER — challenge verdict first, balance second. The parallelism is a latency
// decision; the evaluation semantics are a money decision, and this file is what keeps the two from being
// confused. Two properties are load-bearing, and neither is provable from the serial shape alone:
//
//   1. DETERMINISTIC COUNTER ATTRIBUTION. When BOTH legs would refuse, the counter that moves is ALWAYS
//      `zklogin` — never `balance`, and never both. A naive parallel join (`Promise.all` over two
//      self-counting legs) increments whichever legs get that far, so the /stats refusal census becomes a
//      record of RPC weather rather than of why sponsorship was declined.
//   2. CHALLENGE-REFUSAL PRECEDENCE. No balance-shaped response — the `self-pay-required` reason, the
//      "sign with your own gas" copy — may ever reach a caller whose challenge failed. Under `Promise.all`
//      the rejection that propagates is whichever REJECTS FIRST, so a fast local balance read beats a slow
//      zkLogin verification and hands a failed-auth caller the client's self-pay branch.
//
// Both are proven under a LOSING-RACE fixture: the balance leg is forced to settle first (the ordering that
// makes a naive join answer wrong), and `settle_order` is asserted so the fixture cannot silently degrade into
// a lucky ordering that proves nothing. The verdict is then asserted INVARIANT across both settle orders —
// same counter, same error, whichever leg wins the race.
//
//   bun test ./sponsor.reserve_join.test.js    (no Redis, no fullnode, no station — every door is a double)
//
// Own process on purpose (like every sibling suite): sponsor state + allowlist resolve at module load.

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { Transaction } from '@mysten/sui/transactions'
import { toBase64 } from '@mysten/sui/utils'

import release from '../packages/sdk/src/deployment/release.json' with { type: 'json' }

import { challenge_age_ms } from './zklogin_auth.mjs'

// ── ENV POLARITY, STATED — identical to sponsor.reserve_gate.test.js, and for the same reasons ──
// (in-memory counters need a store-less localnet process; the allowlist is stated because localnet has no
// release.json entry, so the scope arm would otherwise swallow every verdict this file is about).
const ARES = release.networks.testnet.packages.aresrpg.latest
process.env.REDIS_URL = ''
process.env.VITE_NETWORK = 'localnet'
process.env.SPONSOR_ARESRPG_PACKAGES = ARES
process.env.GAS_STATION_URL = 'http://rpc-gas-pool.test:9527'
process.env.GAS_STATION_AUTH = 'test-bearer'

// ── THE RACE CONTROL ──────────────────────────────────────────────────────────────────────────────────
// Both doors are deferred by an explicit delay and record the order in which they actually settle. Explicit
// timers rather than microtask juggling: the point of the fixture is that the LOSER of the race still decides
// the verdict, and that only means something if the race is real and observable.
// `events` is the single log both doors write to — `<leg>:start` when the door is called, `<leg>:settle` when
// it answers. One log rather than two arrays because the two questions this file asks are the same question at
// different resolutions: WHICH leg settled first (the race), and whether both were in flight at once (the
// latency claim). Derive, don't keep a second copy.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let events = []
let next_challenge = { outcome: 'ok', delay_ms: 0 }
let next_balance = { outcome: 'ok', value: '0', delay_ms: 0 }
let next_simulation = null

const core = {
  getBalance: async () => {
    events.push('balance:start')
    await sleep(next_balance.delay_ms)
    events.push('balance:settle')
    if (next_balance.outcome === 'throw') throw new Error('grpc-getbalance-unavailable')
    return { balance: { balance: next_balance.value } }
  },
  simulateTransaction: async () => next_simulation,
}
mock.module('@mysten/sui/grpc', () => ({
  SuiGrpcClient: function SuiGrpcClient() {
    return { core }
  },
}))
mock.module('./zklogin_auth.mjs', () => ({
  // #2263 — the refusal log reads a challenge's AGE through this. The double neutralizes the GATE, never
  // the clock reader, so the real parser is passed through rather than faked into a second answer.
  challenge_age_ms,
  // The free pre-pass is a no-op here on purpose: every fixture below sends a well-formed challenge, so the
  // question this file asks is what happens to the two NETWORK legs. `sponsor.station.test.js` owns the other
  // half — that a request failing this pre-pass never reaches the network at all.
  assert_zklogin_challenge_local: () => {},
  assert_zklogin_challenge: async () => {
    events.push('challenge:start')
    await sleep(next_challenge.delay_ms)
    events.push('challenge:settle')
    if (next_challenge.outcome === 'reject') throw new Error('zklogin-invalid: challenge signature does not verify')
  },
}))

const S = await import('./sponsor.mjs')

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
  events = []
  next_challenge = { outcome: 'ok', delay_ms: 0 }
  next_balance = { outcome: 'ok', value: '0', delay_ms: 0 }
  next_simulation = null
  globalThis.fetch = async (url, init) => {
    station_calls.push({ url: String(url), body: JSON.parse(init.body) })
    return { ok: true, status: 200, json: async () => RESERVATION }
  }
})

const SENDER = `0x${'a1'.repeat(32)}`
const FUNDED = '300000000' // > SELF_PAY_MIST (0.2 SUI) — the balance leg refuses on this
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

// The counters are process-global and only reset on a UTC day roll, so every assertion is a DELTA over one
// call. `sponsor_stats()` hands back the live `refused` object, hence the clone — a snapshot that aliases the
// thing it is measuring measures nothing.
const refusals = () => ({ ...S.sponsor_stats().refused })
const refusal_delta = (before, after) =>
  Object.fromEntries(
    Object.entries(after)
      .filter(([kind, count]) => count !== before[kind])
      .map(([kind, count]) => [kind, count - before[kind]])
  )

// A refusal on either money leg must never reach the station. Asserted on every arm below for the same reason
// sponsor.reserve_gate.test.js asserts it: a refusal that still reserved is a refusal that still burned gas.
const expect_nothing_reserved = () => expect(station_calls).toEqual([])

/**
 * Wait until both legs have actually settled, then report the order they settled in.
 *
 * This drain is not a convenience — it is what makes the counter assertions honest. A `Promise.all` join
 * REJECTS AS SOON AS THE FIRST LEG DOES, so the losing leg's `count_refusal` lands AFTER `reserveSponsored`
 * has already returned to the caller. Snapshotting the counters the instant the call resolves would therefore
 * read a clean `{ zklogin: 1 }` off a join that pollutes the census a tick later — a false green over exactly
 * the defect this file exists to catch. Late is not innocent: it is the bug, delayed.
 *
 * Bounded rather than open-ended so a leg that never runs at all (a serial shape) surfaces as the short order
 * it truly was, in the assertion's own diff, instead of hanging the suite.
 */
const settle_order = () => events.filter((event) => event.endsWith(':settle')).map((event) => event.split(':')[0])
const settled_legs = async (expected, timeout_ms = 250) => {
  const deadline = Date.now() + timeout_ms
  while (settle_order().length < expected && Date.now() < deadline) await sleep(5)
  return settle_order()
}

// ── PROPERTY 1 — deterministic counter attribution ────────────────────────────────────────────────────
describe('BOTH legs would refuse — the counter that moves is ALWAYS the challenge counter', () => {
  const races = {
    'balance settles FIRST (the losing race — a naive join answers with the balance leg here)': {
      challenge_delay: 30,
      balance_delay: 0,
      expected_order: ['balance', 'challenge'],
    },
    'challenge settles first': { challenge_delay: 0, balance_delay: 30, expected_order: ['challenge', 'balance'] },
  }
  for (const [name, { challenge_delay, balance_delay, expected_order }] of Object.entries(races))
    test(`${name} → refused.zklogin +1, refused.balance UNCHANGED`, async () => {
      next_challenge = { outcome: 'reject', delay_ms: challenge_delay }
      next_balance = { outcome: 'ok', value: FUNDED, delay_ms: balance_delay }
      const before = refusals()
      const { value, error } = await reserve()
      const order = await settled_legs(2)
      const after = refusals()

      expect(value).toBeNull()
      // THE PROPERTY, invariant across settle order: exactly one counter moved, and it is the challenge's.
      expect(refusal_delta(before, after)).toEqual({ zklogin: 1 })
      expect(error.message).toMatch(/zklogin-invalid/)
      expect_nothing_reserved()
      // THE FIXTURE CONTROL, asserted last so a real defect above reports itself rather than hiding behind
      // the setup: both legs really ran, and really settled in this order — otherwise the race never happened
      // and the property above proved nothing.
      expect(order).toEqual(expected_order)
    })
})

// ── PROPERTY 2 — challenge-refusal precedence ─────────────────────────────────────────────────────────
describe('a failed challenge never receives a balance-shaped response', () => {
  test('losing race + funded wallet → NO self-pay reason, NO self-pay copy, on the real wire body', async () => {
    next_challenge = { outcome: 'reject', delay_ms: 30 }
    next_balance = { outcome: 'ok', value: FUNDED, delay_ms: 0 }
    const { error } = await reserve()
    const order = await settled_legs(2)

    const body = S.sponsor_error_response(error)
    // The client branches on `reason` — a self-pay tag here makes it silently self-pay for a caller whose
    // authentication just failed. The English is asserted too because the copy is what a human reads.
    expect(body.reason).toBeUndefined()
    expect(error.sponsor_reason).toBeUndefined()
    expect(body.error).not.toMatch(/self-pay/)
    expect(body.error).not.toMatch(/your own gas/)
    expect_nothing_reserved()
    expect(order).toEqual(['balance', 'challenge'])
  })

  test('a challenge failure outranks a balance leg that THREW — the RPC error never surfaces', async () => {
    next_challenge = { outcome: 'reject', delay_ms: 30 }
    next_balance = { outcome: 'throw', delay_ms: 0 }
    const before = refusals()
    const { error } = await reserve()
    const order = await settled_legs(2)
    const after = refusals()

    expect(refusal_delta(before, after)).toEqual({ zklogin: 1 })
    expect(error.message).toMatch(/zklogin-invalid/)
    expect(error.message).not.toMatch(/grpc-getbalance-unavailable/)
    expect_nothing_reserved()
    expect(order).toEqual(['balance', 'challenge'])
  })
})

// ── THE CONTROLS — without these, every assertion above could be passing on a dead balance leg ─────────
describe('POSITIVE CONTROLS — both legs are live and the happy path still reserves', () => {
  test('challenge passes + funded wallet → the balance rail fires, reason "self-pay-required"', async () => {
    next_balance = { outcome: 'ok', value: FUNDED, delay_ms: 0 }
    const before = refusals()
    const { value, error } = await reserve()
    const after = refusals()

    expect(value).toBeNull()
    expect(refusal_delta(before, after)).toEqual({ balance: 1 })
    expect(error.sponsor_reason).toBe(S.SELF_PAY_REASON)
    expect_nothing_reserved()
  })

  test('challenge passes + balance leg THREW → the RPC error propagates raw, no refusal counted', async () => {
    next_balance = { outcome: 'throw', delay_ms: 0 }
    const before = refusals()
    const { value, error } = await reserve()
    const after = refusals()

    expect(value).toBeNull()
    // An RPC that never answered is not a verdict about this request — it must not pollute the refusal census.
    expect(refusal_delta(before, after)).toEqual({})
    expect(error.message).toMatch(/grpc-getbalance-unavailable/)
    expect_nothing_reserved()
  })

  test('challenge passes + unfunded wallet → the join lets a good request all the way to the station', async () => {
    next_challenge = { outcome: 'ok', delay_ms: 10 }
    next_balance = { outcome: 'ok', value: '0', delay_ms: 0 }
    next_simulation = {
      $kind: 'Transaction',
      Transaction: {
        effects: {
          status: { success: true },
          gasUsed: { computationCost: '1270000', storageCost: '22359200', storageRebate: '22135608' },
        },
      },
    }
    const { value, error } = await reserve({ sender: `0x${'b2'.repeat(32)}` })

    expect(error).toBeNull()
    expect(value.reservationId).toBe(4242)
    expect(station_calls.map((call) => call.url)).toEqual(['http://rpc-gas-pool.test:9527/v1/reserve_gas'])
  })
})

// ── THE LATENCY CLAIM — asserted structurally, never as a wall-clock number ────────────────────────────
// The join's entire justification is that the two round-trips cost max(a, b) instead of a + b. That claim is
// the OVERLAP — both doors open before either answers — so the overlap is what gets asserted, off the same
// event log the race tests read. A stopwatch threshold would measure this machine's mood; the interleaving is
// a fact about the code, identical on a loaded CI runner and an idle laptop.
describe('the two reads are IN FLIGHT together — sum becomes max', () => {
  test('both doors are open before either answers, and the balance read is not gated on the challenge', async () => {
    next_challenge = { outcome: 'ok', delay_ms: 40 }
    next_balance = { outcome: 'ok', value: FUNDED, delay_ms: 0 }
    const { error } = await reserve()
    await settled_legs(2)

    // Serial would read challenge:start · challenge:settle · balance:start · balance:settle — the balance read
    // not even DISPATCHED until the slow verification answered, which is the `a + b` this issue removed.
    expect(events).toEqual(['challenge:start', 'balance:start', 'balance:settle', 'challenge:settle'])
    // …and joining them changed nothing about the verdict: a funded wallet with a good challenge still self-pays.
    expect(error.sponsor_reason).toBe(S.SELF_PAY_REASON)
  })
})
