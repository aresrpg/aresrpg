// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { reset_expedition_sdk_mock, set_expedition_sdk_mock } from '../test_helpers/expedition_sdk_mock.js'
import { humanize_tx_error } from '../game/core/abort_copy.js'
import i18n from '../i18n'

import { BALANCE_FRESH_MS, decide_sponsor_route, sponsor_route_log } from './sponsor_route'

const NOW_MS = 1_000_000
const UNDER = 100_000_000n
const OVER = 300_000_000n

const baseline = {
  sponsor_excluded: false,
  is_zklogin: true,
  pref_on: true,
  cached_balance_mist: UNDER,
  cached_balance_read_at_ms: NOW_MS,
  now_ms: NOW_MS,
}

describe('decide_sponsor_route — fresh-cache optimization only', () => {
  const matrix = [
    {
      name: 'fresh-under',
      input: { cached_balance_read_at_ms: NOW_MS - BALANCE_FRESH_MS },
      route: 'sponsored-first',
      reason: 'fresh-balance<=threshold',
    },
    {
      name: 'fresh-over',
      input: { cached_balance_mist: OVER },
      route: 'self-pay',
      reason: 'balance>threshold',
    },
    {
      // stale + LOW → still ask the sponsor (a low balance may have risen above the threshold since our read).
      name: 'stale-low',
      input: { cached_balance_mist: UNDER, cached_balance_read_at_ms: NOW_MS - BALANCE_FRESH_MS - 1 },
      route: 'sponsored-first',
      reason: 'balance-stale',
    },
    {
      name: 'unknown',
      input: { cached_balance_mist: null, cached_balance_read_at_ms: null },
      route: 'sponsored-first',
      reason: 'balance-unknown',
    },
    {
      name: 'sponsor-refused',
      input: { sponsor_refused: true },
      route: 'self-pay',
      reason: 'sponsor-refused',
    },
    {
      name: 'not-zklogin',
      input: { is_zklogin: false },
      route: 'self-pay',
      reason: 'not-zklogin',
    },
    {
      // MONEY-split PTBs (buy/gift split price/royalty off tx.gas) are the SOLE exclusion — a sponsored gas coin
      // would fund the split. A terminal-&Random gameplay tx (keep_budget) is NOT excluded here (it is an
      // orthogonal budget-pin directive the choke consumes, not a routing input) — see index.test.js.
      name: 'sponsor_excluded (money-split off tx.gas)',
      input: { sponsor_excluded: true },
      route: 'self-pay',
      reason: 'excluded-sponsor',
    },
  ] as const

  for (const row of matrix) {
    test(`${row.name} -> ${row.route} with the exact [tx] trace reason`, () => {
      const decision = decide_sponsor_route({ ...baseline, ...row.input })
      expect(decision).toEqual({ route: row.route, reason: row.reason })
      expect(`[tx] ${sponsor_route_log(decision)}`).toBe(`[tx] route: ${row.route} reason=${row.reason}`)
    })
  }
})

// RED-FIRST (live-QA 07-19 — repeated `POST /api/sponsor/reserve` 400s in production). A funded wallet's
// cached balance reads "stale" between turn-based fight commits (turn think-time routinely exceeds BALANCE_FRESH_MS),
// and a stale read USED to route sponsored-first — a guaranteed self-pay-required 400 on EVERY turn. A wallet the
// client last saw above 0.2 SUI is never sponsor-eligible (the @server refuses it by policy: SELF_PAY_MIST), so a
// stale-but-funded balance must route SELF-PAY without re-asking; a rare uncached drain below the threshold is caught
// by the gas-selection fallback (gas_fallback.ts). This row fails at HEAD (it routed sponsored-first/balance-stale).
describe('decide_sponsor_route — a stale funded balance must NOT re-ask the sponsor (07-19 reserve-400 flood)', () => {
  test('stale + above-threshold → self-pay, no doomed reserve', () => {
    const decision = decide_sponsor_route({
      ...baseline,
      cached_balance_mist: OVER,
      cached_balance_read_at_ms: NOW_MS - BALANCE_FRESH_MS - 1, // older than the 30s freshness window
    })
    expect(decision).toEqual({ route: 'self-pay', reason: 'balance>threshold' })
  })
})

// RED-FIRST (r11 anchor gate — 75a49b78 sponsor-first fix routed the anchor rig's ≤0.2-SUI fixture wallet
// SPONSORED for its multi-turn search, but the anchor vite env wires no sponsor URL: the /reserve POST rejected
// with a raw browser "Failed to fetch" (fight_mouse_helpers.ts:398). A sponsor-endpoint FETCH FAILURE (network
// error/timeout — no HTTP status, no decoder-mapped detail) is NOT an explicit refusal; it must fall back exactly
// like any other non-cap sponsor error (index.ts execute_tx): self-pay SILENTLY when the wallet can afford it, or
// an HONEST decoder-recognized refusal (never the raw TypeError) when it cannot. globalThis.fetch is mocked to
// REJECT (mirrors the anchor rig's real failure, not a stubbed run_sponsored) so the REAL sponsor_fetch catch
// (index.ts) is the thing under test, not a fake standing in for it.
const grpc = {
  core: {
    simulateTransaction: mock(async () => ({
      $kind: 'Transaction',
      Transaction: {
        effects: {
          status: { success: true },
          gasUsed: { computationCost: '1000000', storageCost: '2000000', storageRebate: '500000' },
        },
      },
    })),
  },
}
set_expedition_sdk_mock(async () => ({ grpc_client: grpc }))
const { execute_tx } = await import('./index')

describe('execute_tx — a sponsor-endpoint FETCH FAILURE falls back, never leaks the raw browser error (r11 anchor gate)', () => {
  const ADDR = '0xanchor'
  const CHAIN = 'sui:testnet'
  // The wallet needs sui:signPersonalMessage too — execute_sponsored_tx signs the zkLogin challenge BEFORE the
  // /reserve POST. Without it, the sponsor door throws its OWN "does not support signPersonalMessage" error
  // and the mocked-rejecting fetch below is never reached — a false green that never actually exercises it.
  const make_zk_wallet = (sae) => ({
    features: {
      'sui:signAndExecuteTransaction': { signAndExecuteTransaction: sae },
      'sui:signPersonalMessage': { signPersonalMessage: mock(async () => ({ signature: 'zk-sig' })) },
      'enoki:getSession': { getSession: async () => ({}) },
    },
  })
  // build() must resolve — execute_sponsored_tx builds the kind-only bytes BEFORE it ever calls fetch; a tx fake
  // missing it throws its own "build is not a function" first, again short-circuiting past the fetch mock.
  const make_tx = () => ({
    setSenderIfNotSet() {},
    setGasBudget() {},
    build: mock(async () => new Uint8Array([1, 2, 3])),
  })
  const real_fetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = real_fetch
    grpc.core.simulateTransaction.mockClear()
    reset_expedition_sdk_mock()
    set_expedition_sdk_mock(async () => ({ grpc_client: grpc })) // re-arm for the next test in this file
  })

  test('funded wallet (self-pay covers it) → the tx EXECUTES end-to-end via self-pay (dry-run gate + wallet sign+submit), fetch failure never surfaces', async () => {
    globalThis.fetch = mock(async () => {
      throw new TypeError('Failed to fetch')
    })
    const sae = mock(async () => ({ digest: 'SELFPAY' }))
    const res = await execute_tx({
      wallet: make_zk_wallet(sae),
      address: ADDR,
      transaction: make_tx(),
      chain: CHAIN,
      keep_budget: true, // terminal-&Random search — sponsor-eligible, not money-split
      cached_balance_mist: 0n, // ≤0.2 SUI → routes sponsor-first
      cached_balance_read_at_ms: Date.now(),
    })
    // END-TO-END, not merely "the route decided self-pay": the S-54 dry-run gate ran (grpc simulate — the SAME
    // gate every self-pay tx must clear) AND the wallet's real sign+submit fired exactly once, returning a
    // genuine on-chain receipt — the live-degradation path a real player rides, not a stubbed route decision.
    expect(grpc.core.simulateTransaction).toHaveBeenCalledTimes(1)
    expect(sae).toHaveBeenCalledTimes(1)
    expect(res.digest).toBe('SELFPAY') // a REAL receipt — no toast, no thrown error, the fetch failure is invisible
  })

  test('zero-SUI wallet (sponsor unreachable, self-pay also fails gas selection) → the HONEST sponsor-unreachable copy, NEVER "Failed to fetch" NOR "buy 0.4 SUI"', async () => {
    globalThis.fetch = mock(async () => {
      throw new TypeError('Failed to fetch')
    })
    // Live class (gas_fallback.ts GAS_SELECTION_RE / abort_copy.js GAS_BALANCE_RE) — the wallet's own gas
    // selection rejects a truly-empty sender AFTER the S-54 dry-run gate already passed.
    const GAS_SELECTION_ERR =
      'GraphQLResponseError: Invalid argument: Unable to perform gas selection due to insufficient SUI balance of 0 to satisfy required budget 400000000'
    const sae = mock(async () => {
      throw new Error(GAS_SELECTION_ERR)
    })
    const thrown = await execute_tx({
      wallet: make_zk_wallet(sae),
      address: ADDR,
      transaction: make_tx(),
      chain: CHAIN,
      keep_budget: true,
      cached_balance_mist: 0n,
      cached_balance_read_at_ms: Date.now(),
    }).then(
      () => null,
      (e) => e
    )
    expect(thrown).toBeInstanceOf(Error)
    expect(thrown.message).not.toContain('Failed to fetch') // the raw browser TypeError must never reach the caller
    // OWNER P1 (07-19): a zero-SUI wallet the whole game is meant to sponsor must NEVER be told to buy SUI when the
    // real fault is the SPONSOR being unreachable. execute_tx surfaces the (already-humanized) sponsor refusal —
    // the real sponsor_fetch catch mapped the fetch failure to `errors.sponsor_unreachable` — instead of the
    // wallet's gas-selection demand. Honest cause, no raw browser error, no phantom paywall.
    const toast_copy = humanize_tx_error(thrown)
    expect(toast_copy).toBe(i18n.t('errors.sponsor_unreachable'))
    expect(toast_copy).not.toBe(i18n.t('errors.gas_insufficient_balance', { amount: '0.400' })) // the P1 lie is gone
    expect(toast_copy).not.toContain('Failed to fetch')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// RED-FIRST (P1 2026-07-19/20). Live report: "Search failed — Not enough SUI for gas — you need about
// 0.400 SUI free" on a zero/low-SUI wallet, and "can't engage fight either". Canon: the WHOLE GAME is playable
// at ZERO SUI — search + engage route sponsor-FIRST and the STATION is the authoritative gate. When the station
// REFUSES their budget (search/engage bust its per-tx ceiling → sponsor-reserve-failed / -unreachable), the
// client used to fall through to self-pay and a truly-broke wallet then surfaced the WALLET's "need ~0.4 SUI
// free" gas-selection demand — a LIE for a tx the player was never meant to pay. The honest surface is the
// SPONSOR's refusal. SOLE exception: `self-pay-required` (the @server saw a FUNDED 0.2–0.4-SUI wallet) — there
// the balance demand is TRUTHFUL. These rows FAIL at HEAD (execute_tx rethrew the wallet gas error → the 0.400
// copy); GREEN once execute_tx surfaces the captured sponsor refusal instead.
// ─────────────────────────────────────────────────────────────────────────────
describe('execute_tx — station refusal on a sponsor-eligible tx surfaces the HONEST sponsor error, never a balance demand', () => {
  const ADDR = '0xbroke'
  const CHAIN = 'sui:testnet'
  // Live wallet-side gas-selection class (abort_copy GAS_BALANCE_RE / gas_fallback GAS_SELECTION_RE): the wallet
  // finds no coin covering the ~0.4-SUI search budget on a zero-SUI sender, AFTER the S-54 dry-run already passed.
  const GAS_SELECTION_ERR =
    'GraphQLResponseError: Invalid argument: Unable to perform gas selection due to insufficient SUI balance of 0 to satisfy required budget 400000000'
  const make_zk_wallet = (sae: any) => ({
    features: {
      'sui:signAndExecuteTransaction': { signAndExecuteTransaction: sae },
      'sui:signPersonalMessage': { signPersonalMessage: mock(async () => ({ signature: 'zk-sig' })) },
      'enoki:getSession': { getSession: async () => ({}) },
    },
  })
  const make_tx = () => ({ setSenderIfNotSet() {}, setGasBudget() {}, build: mock(async () => new Uint8Array([1])) })
  // The station's over-ceiling refusal, ALREADY humanized by map_sponsor_error (index.ts) exactly as production
  // throws it out of execute_sponsored_tx's sponsor_fetch — no sponsor_refusal tag ⇒ not the funded self-pay case.
  const station_refusal = () => new Error(i18n.t('errors.sponsor_reserve_failed'))

  beforeEach(() => {
    grpc.core.simulateTransaction.mockClear()
    set_expedition_sdk_mock(async () => ({ grpc_client: grpc })) // guard's dry-run must PASS so self-pay is reached
  })
  afterEach(() => {
    grpc.core.simulateTransaction.mockClear()
    reset_expedition_sdk_mock()
    set_expedition_sdk_mock(async () => ({ grpc_client: grpc }))
  })

  test('SEARCH (keep_budget, zero balance): station refuses → toast is the sponsor refusal, NEVER "need 0.400 SUI free"', async () => {
    const sae = mock(async () => {
      throw new Error(GAS_SELECTION_ERR)
    })
    const run_sponsored = mock(async () => {
      throw station_refusal()
    })
    const thrown = await execute_tx({
      wallet: make_zk_wallet(sae) as any,
      address: ADDR,
      transaction: make_tx() as any,
      chain: CHAIN,
      keep_budget: true, // terminal-&Random search — sponsor-eligible, not money-split
      cached_balance_mist: 0n, // zero SUI → sponsor-first (the station is the gate)
      cached_balance_read_at_ms: Date.now(),
      sponsor_fallback: { fetch_balance_mist: async () => 0n, run_sponsored },
    }).then(
      () => null,
      (e) => e
    )
    expect(thrown).toBeInstanceOf(Error)
    expect(run_sponsored).toHaveBeenCalledTimes(1) // sponsor-first WAS requested (the routing half of the canon)
    // The SPONSOR's honest refusal is what surfaces — the player learns sponsorship is momentarily unavailable…
    expect(thrown.message).toBe(i18n.t('errors.sponsor_reserve_failed'))
    // …NEVER the wallet's "buy 0.4 SUI" demand (the P1 lie); the ONE decoder must not reproduce it either.
    const toast = humanize_tx_error(thrown)
    expect(toast).not.toContain('0.400')
    expect(toast).not.toBe(i18n.t('errors.gas_insufficient_balance', { amount: '0.400' }))
  })

  test('ENGAGE (fight create, 0.1-SUI wallet): station refuses → sponsor refusal, never a balance demand', async () => {
    const sae = mock(async () => {
      throw new Error(GAS_SELECTION_ERR)
    })
    const thrown = await execute_tx({
      wallet: make_zk_wallet(sae) as any,
      address: ADDR,
      transaction: make_tx() as any,
      chain: CHAIN,
      cached_balance_mist: 100_000_000n, // 0.1 SUI (≤ 0.2) → sponsor-first — exactly the blocked state above
      cached_balance_read_at_ms: Date.now(),
      sponsor_fallback: {
        fetch_balance_mist: async () => 100_000_000n,
        run_sponsored: mock(async () => {
          throw station_refusal()
        }),
      },
    }).then(
      () => null,
      (e) => e
    )
    expect(thrown.message).toBe(i18n.t('errors.sponsor_reserve_failed'))
    expect(humanize_tx_error(thrown)).not.toContain('0.400')
  })

  test('sponsor SUCCEEDS for a zero-SUI search → sponsored, self-pay NEVER touched (route sponsor-first)', async () => {
    const sae = mock(async () => ({ digest: 'SELFPAY' }))
    const run_sponsored = mock(async () => ({ digest: 'SPONSORED', effects: { status: { status: 'success' } } }))
    const res = await execute_tx({
      wallet: make_zk_wallet(sae) as any,
      address: ADDR,
      transaction: make_tx() as any,
      chain: CHAIN,
      keep_budget: true,
      cached_balance_mist: 0n,
      cached_balance_read_at_ms: Date.now(),
      sponsor_fallback: { fetch_balance_mist: async () => 0n, run_sponsored },
    })
    expect(res.digest).toBe('SPONSORED')
    expect(run_sponsored).toHaveBeenCalledTimes(1)
    expect(sae).toHaveBeenCalledTimes(0) // a broke wallet never touches self-pay when the station serves it
  })

  test('EXCEPTION — self-pay-required (funded 0.2–0.4 SUI): the "need ~0.4 SUI" demand is TRUTHFUL and is kept', async () => {
    const sae = mock(async () => {
      throw new Error(GAS_SELECTION_ERR)
    })
    const self_pay_required = () => {
      const e = new Error(i18n.t('errors.sponsor_self_pay')) as Error & { sponsor_refusal?: string }
      e.sponsor_refusal = 'self-pay-required' // the @server's FRESH read saw a funded wallet (SELF_PAY_MIST)
      return e
    }
    const thrown = await execute_tx({
      wallet: make_zk_wallet(sae) as any,
      address: ADDR,
      transaction: make_tx() as any,
      chain: CHAIN,
      keep_budget: true,
      cached_balance_mist: 0n,
      cached_balance_read_at_ms: Date.now(),
      sponsor_fallback: {
        fetch_balance_mist: async () => 0n,
        run_sponsored: mock(async () => {
          throw self_pay_required()
        }),
      },
    }).then(
      () => null,
      (e) => e
    )
    // A wallet holding 0.2–0.4 SUI genuinely needs ~0.4 to self-pay search — the gas demand is HONEST here, kept.
    expect(humanize_tx_error(thrown)).toBe(i18n.t('errors.gas_insufficient_balance', { amount: '0.400' }))
  })
})
