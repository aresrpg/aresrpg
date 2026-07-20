// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// S-54 — proves THE tx door never signs a would-fail tx (no execute on dry-run failure =
// no real-fund drain), pins storage + computation ×1.5, refuses over GAS_CEILING_SUI, KEEPS the builder budget for
// &Random buys while STILL dry-running them (bypass closed), and NEVER retries an executed failure. The gRPC
// client is mocked (no live network) — the simulate result is a hand-built grpc `effects` block.
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { use_settings } from '../stores/settings'
import i18n from '../i18n'
import { reset_expedition_sdk_mock, set_expedition_sdk_mock } from '../test_helpers/expedition_sdk_mock.js'

// Mock the SDK BEFORE importing the module under test — get_sdk is the only I/O seam the choke reaches.
const sim = { current: /** @type {any} */ (null) }
const grpc = {
  core: {
    simulateTransaction: mock(async () => sim.current),
    executeTransaction: mock(async () => ({
      Transaction: { digest: 'SPONSORED', effects: { status: { success: true } } },
    })),
  },
}
const get_sdk = async () => ({ grpc_client: grpc })
set_expedition_sdk_mock(get_sdk)

const {
  execute_tx,
  execute_sponsored_tx,
  build_sponsored_kind,
  SPONSOR_REFUSAL_DAILY_CAP,
  is_sponsor_self_pay_refusal,
  is_sponsor_daily_cap_refusal,
} = await import('./index')
const { clear_budget_cache } = await import('./budget_cache.js')
const { chain_gas_from_receipt, clear_gas_coin_cache, _peek_gas_cache } = await import('./gas_coin_cache.js')
const { get_log_buffer, _reset_log_for_test } = await import('../core/log.js')
const { error_executed_digest } = await import('../world-shell/tx_digest_error.js')
const { is_preflight_refusal } = await import('../game/core/abort_copy.js')

// grpc simulateTransaction result vectors (mirror gas_guard.test.js: gasUsed = computation + storage − rebate)
const ok_sim = (computationCost, storageCost, storageRebate = '0') => ({
  $kind: 'Transaction',
  Transaction: { effects: { status: { success: true }, gasUsed: { computationCost, storageCost, storageRebate } } },
})
const failed_sim = () => ({
  $kind: 'FailedTransaction',
  FailedTransaction: {
    effects: {
      status: {
        success: false,
        error: { $kind: 'MoveAbort', MoveAbort: { abortCode: '106', location: { module: 'character' } } },
      },
      gasUsed: { computationCost: '1000000', storageCost: '0', storageRebate: '0' },
    },
  },
})

const make_tx = (budget_spy = () => {}) => ({ setSenderIfNotSet() {}, setGasBudget: budget_spy })
const make_wallet = (sae_spy) => ({
  features: { 'sui:signAndExecuteTransaction': { signAndExecuteTransaction: sae_spy } },
})
const CHAIN = 'sui:testnet'
const ADDR = '0xabc'

beforeEach(() => set_expedition_sdk_mock(get_sdk))

afterEach(() => {
  grpc.core.simulateTransaction.mockClear()
  grpc.core.executeTransaction.mockClear()
  reset_expedition_sdk_mock()
})

describe('execute_tx — the tx choke (S-54)', () => {
  test('sim-fail → REFUSES before signing (wallet never called = zero gas)', async () => {
    sim.current = failed_sim()
    const sae = mock(async () => ({ digest: 'X' }))
    await expect(
      execute_tx({ wallet: make_wallet(sae), address: ADDR, transaction: make_tx(), chain: CHAIN })
    ).rejects.toThrow()
    expect(grpc.core.simulateTransaction).toHaveBeenCalledTimes(1) // it DID dry-run
    expect(sae).toHaveBeenCalledTimes(0) // …and NEVER signed
  })

  test('over-ceiling (>0.25 SUI net) → REFUSES before signing', async () => {
    sim.current = ok_sim('250000000', '60000000', '10000000') // net 0.300 SUI (testnet ceiling 0.25 — gas_guard.js)
    const sae = mock(async () => ({ digest: 'X' }))
    await expect(
      execute_tx({ wallet: make_wallet(sae), address: ADDR, transaction: make_tx(), chain: CHAIN })
    ).rejects.toThrow()
    expect(sae).toHaveBeenCalledTimes(0)
  })

  test('normal self-pay → pins budget = storage + computation ×1.5, executes exactly once', async () => {
    sim.current = ok_sim('1000000', '2000000', '500000') // storage 2M + computation 1M×1.5 → 3.5M
    const budget = mock(() => {})
    const sae = mock(async () => ({ digest: 'OK' }))
    const res = await execute_tx({
      wallet: make_wallet(sae),
      address: ADDR,
      transaction: make_tx(budget),
      chain: CHAIN,
    })
    expect(budget).toHaveBeenCalledWith(3_500_000n)
    expect(sae).toHaveBeenCalledTimes(1)
    expect(res.digest).toBe('OK')
  })

  test('&Random (keep_budget) → STILL dry-runs (bypass closed) and KEEPS the builder budget', async () => {
    sim.current = ok_sim('1000000', '2000000', '500000')
    const budget = mock(() => {})
    const sae = mock(async () => ({ digest: 'BUY' }))
    const res = await execute_tx({
      wallet: make_wallet(sae),
      address: ADDR,
      transaction: make_tx(budget),
      chain: CHAIN,
      keep_budget: true,
    })
    expect(grpc.core.simulateTransaction).toHaveBeenCalledTimes(1) // the &Random bypass is CLOSED
    expect(budget).toHaveBeenCalledTimes(0) // builder's pinned budget kept as the MAX bound (untouched)
    expect(res.digest).toBe('BUY')
  })

  test('&Random that WOULD fail → refuses before signing too', async () => {
    sim.current = failed_sim()
    const sae = mock(async () => ({ digest: 'X' }))
    await expect(
      execute_tx({ wallet: make_wallet(sae), address: ADDR, transaction: make_tx(), chain: CHAIN, keep_budget: true })
    ).rejects.toThrow()
    expect(sae).toHaveBeenCalledTimes(0)
  })

  test('executed failure (digest exists) → returned as-is, NEVER auto-retried', async () => {
    sim.current = ok_sim('1000000', '2000000', '500000') // dry-run passes; the FAILURE happens on-chain
    const sae = mock(async () => ({ digest: 'EXECUTED_FAIL', effects: 'someEffects' }))
    const res = await execute_tx({ wallet: make_wallet(sae), address: ADDR, transaction: make_tx(), chain: CHAIN })
    expect(sae).toHaveBeenCalledTimes(1) // exactly one invocation — zero retry logic in the module
    expect(res.digest).toBe('EXECUTED_FAIL')
  })

  test('wallet missing the feature → throws (no silent no-op, refused before simulating)', async () => {
    sim.current = ok_sim('1000000', '2000000', '500000')
    await expect(
      execute_tx({ wallet: { features: {} }, address: ADDR, transaction: make_tx(), chain: CHAIN })
    ).rejects.toThrow(/does not support/)
    expect(grpc.core.simulateTransaction).toHaveBeenCalledTimes(0)
  })
})

// PER-FIGHT BUDGET CACHE (latency lever 1) — end-to-end through the REAL guard(): a shape-stable act repeated in
// the same fight reuses its first dry-run's budget and SKIPS simulate. A `getData()`-bearing tx (the real
// Transaction shape) engages the cache; the plain make_tx above has none → key null → always dry-runs (why the
// suite above is untouched). Budget is STILL sim-derived (the first leg dry-ran); the ceiling arm never bypassed.
const cacheable_tx = (fn, fight, budget_spy = () => {}) => ({
  setSenderIfNotSet() {},
  setGasBudget: budget_spy,
  getData: () => ({
    commands: [{ $kind: 'MoveCall', MoveCall: { package: '0xpkg', module: 'actions', function: fn } }],
    inputs: [
      { $kind: 'UnresolvedObject', UnresolvedObject: { objectId: fight } },
      { $kind: 'Pure', Pure: { bytes: 'destination-cell' } }, // a per-act arg — excluded from the key
    ],
  }),
})

describe('per-fight budget cache — skips the repeat dry-run (lever 1)', () => {
  const exec = (tx) =>
    execute_tx({
      wallet: make_wallet(mock(async () => ({ digest: 'OK' }))),
      address: ADDR,
      transaction: tx,
      chain: CHAIN,
    })
  afterEach(() => clear_budget_cache())

  test('same-shape act twice in a fight → 2nd SKIPS the dry-run, same computation-padded budget pinned', async () => {
    clear_budget_cache()
    sim.current = ok_sim('1000000', '2000000', '500000') // storage 2M + computation 1M×1.5 → 3.5M
    const b1 = mock(() => {})
    const b2 = mock(() => {})
    await exec(cacheable_tx('act_move', '0xfightA', b1)) // MISS → dry-run + cache
    await exec(cacheable_tx('act_move', '0xfightA', b2)) // HIT → no dry-run
    expect(grpc.core.simulateTransaction).toHaveBeenCalledTimes(1) // the win: the 2nd leg skipped simulate
    expect(b1).toHaveBeenCalledWith(3_500_000n) // 1st: sim-derived
    expect(b2).toHaveBeenCalledWith(3_500_000n) // 2nd: cached, identical budget still pinned (never unbudgeted)
  })

  test('a DIFFERENT fight → a cache MISS (dry-runs fresh — never reuse across fights)', async () => {
    clear_budget_cache()
    sim.current = ok_sim('1000000', '2000000', '500000')
    await exec(cacheable_tx('act_move', '0xfightA'))
    await exec(cacheable_tx('act_move', '0xfightB')) // different fight object ⇒ different key
    expect(grpc.core.simulateTransaction).toHaveBeenCalledTimes(2)
  })

  test('clear_budget_cache (fight end / executed failure) → the next same-shape act dry-runs fresh', async () => {
    clear_budget_cache()
    sim.current = ok_sim('1000000', '2000000', '500000')
    await exec(cacheable_tx('act_move', '0xfightA')) // MISS → cache
    clear_budget_cache() // an executed on-chain failure or a fight boundary
    await exec(cacheable_tx('act_move', '0xfightA')) // MISS again (invalidated)
    expect(grpc.core.simulateTransaction).toHaveBeenCalledTimes(2)
  })

  test('&Random keep_budget buys are NEVER cached (always dry-run — the terminal-random law is untouched)', async () => {
    clear_budget_cache()
    sim.current = ok_sim('1000000', '2000000', '500000')
    const buy = mock(async () => ({ digest: 'BUY' }))
    await execute_tx({
      wallet: make_wallet(buy),
      address: ADDR,
      transaction: cacheable_tx('buy', '0xshop'),
      chain: CHAIN,
      keep_budget: true,
    })
    await execute_tx({
      wallet: make_wallet(buy),
      address: ADDR,
      transaction: cacheable_tx('buy', '0xshop'),
      chain: CHAIN,
      keep_budget: true,
    })
    expect(grpc.core.simulateTransaction).toHaveBeenCalledTimes(2) // keep_budget ⇒ key null ⇒ no cache
  })
})

// FIX (P0 2026-07-09): a live join_world crashed with "No sui client passed to Transaction#build, but
// transaction data was not sufficient to build offline" — the sponsored kind-only build was client-free, which is
// fine for the all-static create PTB but join_world carries UNRESOLVED runtime object inputs (world shared +
// kiosk/cap owned) that need on-chain resolution. build_sponsored_kind keeps the offline fast path and, on that
// specific failure, rebuilds WITH the gRPC core client (get_sdk().grpc_client, mocked here as `grpc`).
// LAYER 2 (live bug): the gRPC resolver stamps sender 0x0 when unset → the node rejects the owned kiosk/cap
// ("owned by 0x…, but given owner/signer address is 0x0000…") — so the SENDER must be set BEFORE any build call.
const OFFLINE_ERR =
  'No sui client passed to Transaction#build, but transaction data was not sufficient to build offline.'

/** Mock sponsored tx: records the call ORDER so the tests prove setSenderIfNotSet fires before the first build. */
const make_sponsored_tx = (build_impl) => {
  const calls = []
  const build = mock(async (opts) => {
    calls.push('build')
    return build_impl(opts)
  })
  const set_sender = mock((addr) => {
    calls.push(`sender:${addr}`)
  })
  return { tx: { build, setSenderIfNotSet: set_sender }, build, set_sender, calls }
}

describe('build_sponsored_kind — offline-first, gRPC-client fallback for runtime inputs', () => {
  test('all-static PTB → sender set FIRST, builds offline, never touches a client', async () => {
    const { tx, build, calls } = make_sponsored_tx(({ client, onlyTransactionKind }) => {
      expect(onlyTransactionKind).toBe(true)
      if (client) throw new Error('offline build must not receive a client')
      return new Uint8Array([1, 2, 3])
    })
    const kind = await build_sponsored_kind(tx, ADDR)
    expect(kind).toEqual(new Uint8Array([1, 2, 3]))
    expect(build).toHaveBeenCalledTimes(1) // no fallback needed
    expect(calls).toEqual([`sender:${ADDR}`, 'build']) // owner-context BEFORE the build (layer-2 fix)
  })

  test('runtime-object PTB (join_world) → offline build refuses, rebuilds WITH the gRPC client (sender already set)', async () => {
    const { tx, build, calls } = make_sponsored_tx(({ client, onlyTransactionKind }) => {
      expect(onlyTransactionKind).toBe(true) // STILL kind-only on the fallback (gas/sender stay the sponsor's)
      if (!client) throw new Error(OFFLINE_ERR)
      expect(client).toBe(grpc) // the resolving build gets the exact get_sdk() gRPC client
      return new Uint8Array([9, 9])
    })
    const kind = await build_sponsored_kind(tx, ADDR)
    expect(kind).toEqual(new Uint8Array([9, 9]))
    expect(build).toHaveBeenCalledTimes(2) // offline (throws) → gRPC (succeeds)
    // the sender was set ONCE, before the offline attempt — so the gRPC resolver's ownership checks run as the
    // real owner (never 0x0), and the fallback build needs no re-set.
    expect(calls).toEqual([`sender:${ADDR}`, 'build', 'build'])
  })

  test('a NON-offline build error is rethrown as-is (no client retry, no round-trip)', async () => {
    const { tx, build } = make_sponsored_tx(() => {
      throw new Error('some other build failure')
    })
    await expect(build_sponsored_kind(tx, ADDR)).rejects.toThrow(/some other build failure/)
    expect(build).toHaveBeenCalledTimes(1) // never fell back
  })
})

// GAS-STATION FALLBACK LAW (DECISIONS 07-10) — the CHOKE wiring: a pre-execution gas-selection throw
// from the wallet re-routes through the injected sponsor door; keep_budget (&Random gas-split) flows and
// non-zkLogin sessions never do. The full gate matrix lives in gas_fallback.test.js (pure, injected) — these
// tests pin that execute_tx actually threads the error + gates into it.
const GAS_SELECTION_ERR =
  'GraphQLResponseError: Invalid argument: Unable to perform gas selection due to insufficient SUI balance of 83000000 to satisfy required budget 85126200'

const make_zk_wallet = (sae_spy) => ({
  features: {
    'sui:signAndExecuteTransaction': { signAndExecuteTransaction: sae_spy },
    'enoki:getSession': { getSession: async () => ({}) }, // the zkLogin marker the fallback gate reads
  },
})
const fallback_deps = (over = {}) => ({
  fetch_balance_mist: mock(async () => 1_000_000n), // fresh dust — well under the 0.2 SUI boundary
  run_sponsored: mock(async () => ({ digest: 'SPONSORED', effects: { status: { status: 'success' } } })),
  ...over,
})

describe('execute_tx — gas-station fallback wiring (DECISIONS 07-10)', () => {
  test('wallet gas-selection throw + zkLogin + low balance → the SAME tx rides the sponsor door', async () => {
    sim.current = ok_sim('1000000', '2000000', '500000') // guard passes; the wallet then fails gas selection
    const sae = mock(async () => {
      throw new Error(GAS_SELECTION_ERR)
    })
    const deps = fallback_deps()
    const transaction = make_tx()
    const res = await execute_tx({
      wallet: make_zk_wallet(sae),
      address: ADDR,
      transaction,
      chain: CHAIN,
      cached_balance_mist: 300_000_000n,
      cached_balance_read_at_ms: Date.now(),
      sponsor_fallback: deps,
    })
    expect(res.digest).toBe('SPONSORED')
    expect(sae).toHaveBeenCalledTimes(1) // self-pay attempted exactly once…
    expect(deps.run_sponsored).toHaveBeenCalledTimes(1) // …then exactly one sponsored re-route
    expect(deps.run_sponsored.mock.calls[0][0]).toBe(transaction) // the SAME PTB, never rebuilt
  })

  test('money-split buy (keep_budget + sponsor_excluded) NEVER falls back — the drain class is excluded at the choke', async () => {
    sim.current = ok_sim('1000000', '2000000', '500000')
    const sae = mock(async () => {
      throw new Error(GAS_SELECTION_ERR)
    })
    const deps = fallback_deps()
    await expect(
      execute_tx({
        wallet: make_zk_wallet(sae),
        address: ADDR,
        transaction: make_tx(),
        chain: CHAIN,
        keep_budget: true,
        sponsor_excluded: true, // money-split: splits the item price off tx.gas
        sponsor_fallback: deps,
      })
    ).rejects.toThrow(/gas selection/)
    expect(deps.run_sponsored).toHaveBeenCalledTimes(0)
    expect(deps.fetch_balance_mist).toHaveBeenCalledTimes(0)
  })

  test('non-zkLogin wallet (no enoki:getSession) → the raw error propagates, sponsor untouched', async () => {
    sim.current = ok_sim('1000000', '2000000', '500000')
    const sae = mock(async () => {
      throw new Error(GAS_SELECTION_ERR)
    })
    const deps = fallback_deps()
    await expect(
      execute_tx({
        wallet: make_wallet(sae), // plain wallet — no enoki feature
        address: ADDR,
        transaction: make_tx(),
        chain: CHAIN,
        cached_balance_mist: 300_000_000n,
        cached_balance_read_at_ms: Date.now(),
        sponsor_fallback: deps,
      })
    ).rejects.toThrow(/gas selection/)
    expect(deps.run_sponsored).toHaveBeenCalledTimes(0)
  })

  test('a guard SIM-REFUSE is not a gas-selection failure — refused with zero gas, sponsor untouched', async () => {
    sim.current = failed_sim() // the tx WOULD abort on-chain — sponsoring it would burn the sponsor instead
    const sae = mock(async () => ({ digest: 'X' }))
    const deps = fallback_deps()
    await expect(
      execute_tx({
        wallet: make_zk_wallet(sae),
        address: ADDR,
        transaction: make_tx(),
        chain: CHAIN,
        cached_balance_mist: 300_000_000n,
        cached_balance_read_at_ms: Date.now(),
        sponsor_fallback: deps,
      })
    ).rejects.toThrow()
    expect(sae).toHaveBeenCalledTimes(0)
    expect(deps.run_sponsored).toHaveBeenCalledTimes(0)
  })
})

// GAS-COIN PIN + SOLO DRY-RUN SKIP (<1s lane) — the CHOKE wiring: a chained turn commit skips the
// dry-run for a solo fight (measured budget), pins its gas coin, and never signs an over-ceiling budget; a
// multiplayer commit KEEPS the dry-run (zero-gas overdue detection); any NON-commit tx invalidates the pin
// (equivocation guard). The pure pin state machine is proven in gas_coin_cache.test.js.
const make_commit_tx = (budget, spy = {}) => ({
  setSenderIfNotSet() {},
  setGasBudget() {},
  getData: () => ({ gasData: { budget } }), // the solo skip path reads the builder's measured budget from here
  setGasPayment(refs) {
    spy.payment = refs
  },
  setGasPrice(p) {
    spy.price = p
  },
})
const price_sdk = (price = '1000') => ({
  grpc_client: { core: { getReferenceGasPrice: async () => ({ referenceGasPrice: price }) } },
})
const gas_receipt = (id, version, digest, epoch = '42') => ({
  Transaction: { epoch, effects: { gasObject: { id, outputVersion: version, outputDigest: digest } } },
})

describe('execute_tx — gas-coin pin + solo dry-run skip (<1s lane)', () => {
  afterEach(() => clear_gas_coin_cache())

  test('solo commit (gas_pin.skip_sim) → NO dry-run, signs once, keeps the measured budget', async () => {
    const sae = mock(async () => ({ digest: 'COMMIT' }))
    const res = await execute_tx({
      wallet: make_wallet(sae),
      address: ADDR,
      transaction: make_commit_tx('30000000'), // ~0.03 SUI — under the 0.25 ceiling
      chain: CHAIN,
      gas_pin: { skip_sim: true },
    })
    expect(grpc.core.simulateTransaction).toHaveBeenCalledTimes(0) // THE WIN: the solo commit skips the dry-run
    expect(sae).toHaveBeenCalledTimes(1)
    expect(res.digest).toBe('COMMIT')
  })

  test('solo commit with an OVER-CEILING measured budget → REFUSES before signing (money-law backstop)', async () => {
    const sae = mock(async () => ({ digest: 'X' }))
    await expect(
      execute_tx({
        wallet: make_wallet(sae),
        address: ADDR,
        transaction: make_commit_tx('300000000'), // 0.30 SUI — over the 0.25 ceiling
        chain: CHAIN,
        gas_pin: { skip_sim: true },
      })
    ).rejects.toThrow()
    expect(sae).toHaveBeenCalledTimes(0)
    expect(grpc.core.simulateTransaction).toHaveBeenCalledTimes(0)
  })

  test('solo commit with NO pinned budget → refuses (never sign an unbudgeted turn)', async () => {
    const sae = mock(async () => ({ digest: 'X' }))
    const tx = { setSenderIfNotSet() {}, getData: () => ({ gasData: {} }), setGasPayment() {}, setGasPrice() {} }
    await expect(
      execute_tx({
        wallet: make_wallet(sae),
        address: ADDR,
        transaction: tx,
        chain: CHAIN,
        gas_pin: { skip_sim: true },
      })
    ).rejects.toThrow()
    expect(sae).toHaveBeenCalledTimes(0)
  })

  test('solo commit with a chained coin → pins the EXACT gas coin ref + price (zero build round-trip)', async () => {
    await chain_gas_from_receipt(price_sdk('1000'), gas_receipt('0xcoin', '7', 'digZ'))
    const spy = {}
    await execute_tx({
      wallet: make_wallet(mock(async () => ({ digest: 'COMMIT' }))),
      address: ADDR,
      transaction: make_commit_tx('30000000', spy),
      chain: CHAIN,
      gas_pin: { skip_sim: true },
    })
    expect(spy.payment).toEqual([{ objectId: '0xcoin', version: '7', digest: 'digZ' }])
    expect(spy.price).toBe('1000')
  })

  test('MULTIPLAYER commit (skip_sim:false) → STILL dry-runs (zero-gas overdue detection kept) AND pins the coin', async () => {
    sim.current = ok_sim('1000000', '2000000', '500000')
    await chain_gas_from_receipt(price_sdk('1000'), gas_receipt('0xcoin', '3', 'digM'))
    const spy = {}
    await execute_tx({
      wallet: make_wallet(mock(async () => ({ digest: 'MP' }))),
      address: ADDR,
      transaction: make_commit_tx('x', spy),
      chain: CHAIN,
      gas_pin: { skip_sim: false },
    })
    expect(grpc.core.simulateTransaction).toHaveBeenCalledTimes(1) // sim KEPT — the overdue auto-crank stays zero-gas
    expect(spy.payment).toEqual([{ objectId: '0xcoin', version: '3', digest: 'digM' }]) // + gas coin still pinned
  })

  test('equivocation guard: a NON-commit tx (no gas_pin) drops the chained gas coin', async () => {
    sim.current = ok_sim('1000000', '2000000', '500000')
    await chain_gas_from_receipt(price_sdk('1000'), gas_receipt('0xcoin', '2', 'digE'))
    expect(_peek_gas_cache().coin).not.toBeNull()
    await execute_tx({
      wallet: make_wallet(mock(async () => ({ digest: 'SEND' }))),
      address: ADDR,
      transaction: make_tx(),
      chain: CHAIN,
    })
    expect(_peek_gas_cache().coin).toBeNull() // the coin may have moved → pin invalidated before the next commit
  })
})

// SPONSOR-FIRST ROUTE (a 0.11-SUI live wallet got ZERO sponsor grants under the old routing) — a low zkLogin
// wallet's sponsor-eligible tx routes to the sponsor FIRST. Only a <=30s high cache may skip that round trip;
// unknown/stale asks the authoritative sponsor. The pref gates BOTH doors; daily-cap blocks; other refusal falls
// through to self-pay.
describe('execute_tx — sponsor-first route', () => {
  const LOW = 100_000_000n // 0.1 SUI — under the 0.2 boundary (a real 0.11 live scenario)
  const HIGH = 3_140_000_000n // 3.14 SUI — over the boundary (the safe live self-pay assertion)
  afterEach(() => use_settings.setState({ sponsored_gameplay_enabled: true })) // reset the process-shared store

  test('low balance + zkLogin + pref ON + not-excluded → SPONSORED FIRST, self-pay never touched', async () => {
    const sae = mock(async () => ({ digest: 'SELFPAY' }))
    const deps = fallback_deps()
    const transaction = make_tx()
    const res = await execute_tx({
      wallet: make_zk_wallet(sae),
      address: ADDR,
      transaction,
      chain: CHAIN,
      cached_balance_mist: LOW,
      cached_balance_read_at_ms: Date.now(),
      sponsor_fallback: deps,
    })
    expect(res.digest).toBe('SPONSORED')
    expect(deps.run_sponsored).toHaveBeenCalledTimes(1)
    expect(deps.run_sponsored.mock.calls[0][0]).toBe(transaction) // the SAME PTB, never rebuilt
    expect(sae).toHaveBeenCalledTimes(0) // the self-pay door was NEVER reached…
    expect(grpc.core.simulateTransaction).toHaveBeenCalledTimes(0) // …nor its dry-run
  })

  test('funded wallet (> 0.2 SUI) → self-pay exactly as today, sponsor-first skipped', async () => {
    sim.current = ok_sim('1000000', '2000000', '500000')
    const sae = mock(async () => ({ digest: 'SELFPAY' }))
    const deps = fallback_deps()
    const res = await execute_tx({
      wallet: make_zk_wallet(sae),
      address: ADDR,
      transaction: make_tx(),
      chain: CHAIN,
      cached_balance_mist: HIGH,
      cached_balance_read_at_ms: Date.now(),
      sponsor_fallback: deps,
    })
    expect(res.digest).toBe('SELFPAY')
    expect(sae).toHaveBeenCalledTimes(1)
    expect(deps.run_sponsored).toHaveBeenCalledTimes(0) // sponsor-first not triggered above the threshold
  })

  test('pref OFF → self-pay BOTH doors (sponsor-first skipped even for a low zkLogin wallet)', async () => {
    use_settings.setState({ sponsored_gameplay_enabled: false })
    sim.current = ok_sim('1000000', '2000000', '500000')
    const sae = mock(async () => ({ digest: 'SELFPAY' }))
    const deps = fallback_deps()
    const res = await execute_tx({
      wallet: make_zk_wallet(sae),
      address: ADDR,
      transaction: make_tx(),
      chain: CHAIN,
      cached_balance_mist: LOW,
      sponsor_fallback: deps,
    })
    expect(res.digest).toBe('SELFPAY')
    expect(sae).toHaveBeenCalledTimes(1)
    expect(deps.run_sponsored).toHaveBeenCalledTimes(0) // door 1 (sponsor-first) closed by the opt-out
  })

  test('excluded (money-split buy: keep_budget + sponsor_excluded) → NEVER sponsor-first, even low zkLogin', async () => {
    sim.current = ok_sim('1000000', '2000000', '500000')
    const sae = mock(async () => ({ digest: 'BUY' }))
    const deps = fallback_deps()
    const res = await execute_tx({
      wallet: make_zk_wallet(sae),
      address: ADDR,
      transaction: make_tx(),
      chain: CHAIN,
      keep_budget: true,
      sponsor_excluded: true, // money-split: a sponsored gas coin would fund the item price
      cached_balance_mist: LOW,
      sponsor_fallback: deps,
    })
    expect(res.digest).toBe('BUY')
    expect(deps.run_sponsored).toHaveBeenCalledTimes(0) // the gas-split drain class is pinned OUT of sponsor-first
    expect(sae).toHaveBeenCalledTimes(1)
  })

  test('unknown cached balance (null) → SPONSORED FIRST (server balance gate is authoritative)', async () => {
    const sae = mock(async () => ({ digest: 'SELFPAY' }))
    const deps = fallback_deps()
    const res = await execute_tx({
      wallet: make_zk_wallet(sae),
      address: ADDR,
      transaction: make_tx(),
      chain: CHAIN,
      cached_balance_mist: null,
      sponsor_fallback: deps,
    })
    expect(res.digest).toBe('SPONSORED')
    expect(deps.run_sponsored).toHaveBeenCalledTimes(1)
    expect(sae).toHaveBeenCalledTimes(0)
  })

  test('sponsor DAILY-CAP refusal → propagates (honest block), never self-pays past the free promise', async () => {
    const sae = mock(async () => ({ digest: 'SELFPAY' }))
    const deps = fallback_deps({
      run_sponsored: mock(async () => {
        throw Object.assign(new Error('daily free gameplay used up'), { sponsor_refusal: SPONSOR_REFUSAL_DAILY_CAP })
      }),
    })
    await expect(
      execute_tx({
        wallet: make_zk_wallet(sae),
        address: ADDR,
        transaction: make_tx(),
        chain: CHAIN,
        cached_balance_mist: LOW,
        cached_balance_read_at_ms: Date.now(),
        sponsor_fallback: deps,
      })
    ).rejects.toThrow('daily free gameplay used up')
    expect(sae).toHaveBeenCalledTimes(0) // the crux: the ≤0.2 wallet's dust is NOT self-paid at the cap
  })

  test('NON-cap sponsor refusal (self-pay-required / drained pool / 400) → SILENT self-pay fallback', async () => {
    _reset_log_for_test()
    sim.current = ok_sim('1000000', '2000000', '500000')
    const sae = mock(async () => ({ digest: 'SELFPAY' }))
    const deps = fallback_deps({
      run_sponsored: mock(async () => {
        throw new Error('Sponsor request failed (400): self-pay-required')
      }),
    })
    const res = await execute_tx({
      wallet: make_zk_wallet(sae),
      address: ADDR,
      transaction: make_tx(),
      chain: CHAIN,
      cached_balance_mist: LOW,
      cached_balance_read_at_ms: Date.now(),
      sponsor_fallback: deps,
    })
    expect(res.digest).toBe('SELFPAY') // fell through to the self-pay door
    expect(deps.run_sponsored).toHaveBeenCalledTimes(1) // sponsor tried once…
    expect(sae).toHaveBeenCalledTimes(1) // …then self-pay
    expect(
      get_log_buffer()
        .filter((entry) => entry.ns === 'tx' && entry.message.startsWith('route:'))
        .map((entry) => `[${entry.ns}] ${entry.message}`)
    ).toEqual([
      '[tx] route: sponsored-first reason=fresh-balance<=threshold',
      '[tx] route: self-pay reason=sponsor-refused',
    ])
  })

  test('sponsored-first EXECUTED failure (receipt failure) → throws the HUMANIZED cause (never raw), NEVER self-pay-retries', async () => {
    // 2026-07-19 ("must say why" fix): this throw now routes through tx_error (the ONE decoder) instead of
    // a bare `new Error(rawString)` — `.message` is humanized copy, the RAW abort string survives on `.cause` for
    // provenance/telemetry (report_error, numeric re-classification), and is_preflight_refusal correctly reads
    // FALSE here (digest exists = gas was burned — never mislabel an executed failure as a zero-gas refusal).
    const sae = mock(async () => ({ digest: 'SELFPAY' }))
    const abort = 'MoveAbort(MoveLocation { module: Identifier("fight") }, 7) in command 0'
    const deps = fallback_deps({
      run_sponsored: mock(async () => ({ digest: 'BURNED', effects: { status: { status: 'failure', error: abort } } })),
    })
    const thrown = await execute_tx({
      wallet: make_zk_wallet(sae),
      address: ADDR,
      transaction: make_tx(),
      chain: CHAIN,
      cached_balance_mist: LOW,
      cached_balance_read_at_ms: Date.now(),
      sponsor_fallback: deps,
    }).catch((error) => error)
    expect(thrown).toBeInstanceOf(Error)
    expect(thrown.message).toBe(i18n.t('errors.tx_failed')) // humanized — fight/7 is unmapped, EXECUTED → the on-chain-failed copy
    expect(thrown.message).not.toContain('MoveAbort') // no-jargon law — the raw chain string never reaches the surface
    expect(thrown.cause).toBe(abort) // provenance preserved for numeric reclassification / telemetry
    expect(is_preflight_refusal(thrown)).toBe(false) // gas WAS burned — never mislabel it a zero-gas refusal
    expect(Object.hasOwn(thrown, 'digest')).toBe(true)
    expect(thrown.digest).toBe('BURNED')
    expect(error_executed_digest(thrown)).toBe('BURNED')
    expect(sae).toHaveBeenCalledTimes(0) // an executed sponsored failure (gas burned) must never re-run as self-pay
  })

  test('sponsored-first pre-flight failure (digest "") → throws the HUMANIZED cause, correctly marked zero-gas, NO executed digest', async () => {
    // BEFORE this fix: a bare `new Error(rawString)` here carried NO SimulationError marker, so an unmapped code
    // on this route wrongly humanized to "executed, gas was spent, don't retry" for a tx that burned NOTHING
    // (digest ''). This is the exact honesty-split bug the "3rd generic refusal" investigation uncovered.
    const sae = mock(async () => ({ digest: 'SELFPAY' }))
    const abort = 'MoveAbort(MoveLocation { module: Identifier("party") }, 999) in command 0'
    const deps = fallback_deps({
      run_sponsored: mock(async () => ({ digest: '', effects: { status: { status: 'failure', error: abort } } })),
    })
    const thrown = await execute_tx({
      wallet: make_zk_wallet(sae),
      address: ADDR,
      transaction: make_tx(),
      chain: CHAIN,
      cached_balance_mist: LOW,
      cached_balance_read_at_ms: Date.now(),
      sponsor_fallback: deps,
    }).catch((error) => error)
    expect(thrown).toBeInstanceOf(Error)
    expect(is_preflight_refusal(thrown)).toBe(true) // THE fix: zero gas correctly recognized on the sponsored route
    expect(thrown.message).toContain(i18n.t('errors.tx_refused_preflight')) // honest zero-gas headline, not "gas was spent"
    expect(thrown.message).not.toContain(i18n.t('errors.tx_failed'))
    expect(thrown.message).toContain('party') // unmapped → "must say why" reason line names module + code
    expect(thrown.message).toContain('999')
    expect(Object.hasOwn(thrown, 'digest')).toBe(false)
    expect(error_executed_digest(thrown)).toBeNull()
    expect(sae).toHaveBeenCalledTimes(0)
  })
})

// SPONSOR-FIRST FOR &RANDOM GAMEPLAY (live-QA: a ZERO-SUI character got "you need 0.400 free" searching and
// "0.069 free" starting a fight). ROOT: keep_budget (terminal-&Random) USED to force self-pay unconditionally
// ('excluded-keep-budget'), so the sponsor served ZERO grants for search/gather/crush/open — the wallet was asked
// for gas it will never hold. keep_budget is now a PURE budget-pin directive; ONLY sponsor_excluded (a PTB that
// splits money off tx.gas — buy/gift) self-pays. Fight-engage (create_fight) is DETERMINISTIC + not excluded — it
// already sponsored; pinned here so it can never regress into the free-balance wall.
describe('execute_tx — sponsor-first for &Random gameplay (search / engage at zero SUI)', () => {
  const ZERO = 0n
  afterEach(() => use_settings.setState({ sponsored_gameplay_enabled: true }))

  test('SEARCH (keep_budget, NOT money-split) at 0 SUI zkLogin → SPONSORED, free balance never demanded', async () => {
    const sae = mock(async () => ({ digest: 'SELFPAY' }))
    const deps = fallback_deps()
    const res = await execute_tx({
      wallet: make_zk_wallet(sae),
      address: ADDR,
      transaction: make_tx(),
      chain: CHAIN,
      keep_budget: true, // terminal-&Random search (SEARCH_ZONE_GAS_MIST 0.4 SUI pinned)
      cached_balance_mist: ZERO, // a zero-SUI character
      cached_balance_read_at_ms: Date.now(),
      sponsor_fallback: deps,
    })
    expect(res.digest).toBe('SPONSORED')
    expect(deps.run_sponsored).toHaveBeenCalledTimes(1) // the sponsor served the grant…
    expect(sae).toHaveBeenCalledTimes(0) // …the self-pay door (which would demand 0.4 free) was NEVER reached
    expect(grpc.core.simulateTransaction).toHaveBeenCalledTimes(0)
  })

  test('ENGAGE (deterministic create_fight, not excluded) at 0 SUI zkLogin → SPONSORED (regression guard)', async () => {
    const sae = mock(async () => ({ digest: 'SELFPAY' }))
    const deps = fallback_deps()
    const res = await execute_tx({
      wallet: make_zk_wallet(sae),
      address: ADDR,
      transaction: make_tx(),
      chain: CHAIN,
      cached_balance_mist: ZERO,
      cached_balance_read_at_ms: Date.now(),
      sponsor_fallback: deps,
    })
    expect(res.digest).toBe('SPONSORED')
    expect(deps.run_sponsored).toHaveBeenCalledTimes(1)
    expect(sae).toHaveBeenCalledTimes(0)
  })

  test('BUY (keep_budget + sponsor_excluded, splits price off tx.gas) at 0 SUI zkLogin → SELF-PAY, sponsor untouched', async () => {
    sim.current = ok_sim('1000000', '2000000', '500000')
    const sae = mock(async () => ({ digest: 'BUY' }))
    const deps = fallback_deps()
    const res = await execute_tx({
      wallet: make_zk_wallet(sae),
      address: ADDR,
      transaction: make_tx(),
      chain: CHAIN,
      keep_budget: true,
      sponsor_excluded: true, // money-split: a sponsored gas coin would pay the item price = a drain
      cached_balance_mist: ZERO,
      cached_balance_read_at_ms: Date.now(),
      sponsor_fallback: deps,
    })
    expect(res.digest).toBe('BUY')
    expect(deps.run_sponsored).toHaveBeenCalledTimes(0) // the drain class stays OUT of sponsorship…
    expect(sae).toHaveBeenCalledTimes(1) // …and self-pays, exactly as before
  })

  test('SEARCH with a STALE-HIGH cache → self-pay gas-selection → FALLS BACK to the sponsor (fresh reads low)', async () => {
    sim.current = ok_sim('1000000', '2000000', '500000')
    const sae = mock(async () => {
      throw new Error(GAS_SELECTION_ERR)
    })
    const deps = fallback_deps() // fresh balance reads 1M dust (< 0.2 SUI)
    const res = await execute_tx({
      wallet: make_zk_wallet(sae),
      address: ADDR,
      transaction: make_tx(),
      chain: CHAIN,
      keep_budget: true, // search — NOT money-split
      cached_balance_mist: 300_000_000n, // stale HIGH → self-pays first…
      cached_balance_read_at_ms: Date.now(),
      sponsor_fallback: deps,
    })
    expect(res.digest).toBe('SPONSORED') // …then the gas-selection fallback catches the truly-low wallet
    expect(sae).toHaveBeenCalledTimes(1)
    expect(deps.run_sponsored).toHaveBeenCalledTimes(1)
  })
})

// EXECUTE-CERT FAST PATH (want_effects — the fight commit choke's <1s lane, measured 07-12): sign-only via the
// wallet + ONE gRPC executeTransaction with the FULL include; the certified result rides back as `effects_result`
// so the fight sign() skips its ~570ms waitForTransaction read leg. Money rails pinned here: the S-54 dry-run gate
// still runs first, ONE submit ever (an executed {FailedTransaction} is RETURNED with its digest — gas burned,
// never re-fired), and every path that bypasses the fast lane returns NO effects_result (the caller keeps waiting).
const make_cert_wallet = (st_spy, sae_spy = mock(async () => ({ digest: 'WALLET' }))) => ({
  features: {
    'sui:signAndExecuteTransaction': { signAndExecuteTransaction: sae_spy },
    'sui:signTransaction': { signTransaction: st_spy },
  },
})

describe('execute_tx — EXECUTE-CERT fast path (want_effects, <1s lane)', () => {
  test('sign-only wallet → ONE gRPC execute with the FULL include, certified effects_result returned', async () => {
    sim.current = ok_sim('1000000', '2000000', '500000')
    const st = mock(async () => ({ signature: 'sig', bytes: 'AAAA' }))
    const sae = mock(async () => ({ digest: 'WALLET' }))
    const certified = { Transaction: { digest: 'CERT', effects: { status: { success: true } } } }
    grpc.core.executeTransaction.mockImplementationOnce(async () => certified)
    const res = await execute_tx({
      wallet: make_cert_wallet(st, sae),
      address: ADDR,
      transaction: make_tx(),
      chain: CHAIN,
      want_effects: true,
    })
    expect(grpc.core.simulateTransaction).toHaveBeenCalledTimes(1) // the S-54 dry-run gate is untouched
    expect(st).toHaveBeenCalledTimes(1) // sign-only…
    expect(sae).toHaveBeenCalledTimes(0) // …the wallet-execute door never fires
    expect(grpc.core.executeTransaction).toHaveBeenCalledTimes(1)
    expect(grpc.core.executeTransaction.mock.calls[0][0].include).toEqual({
      effects: true,
      objectTypes: true,
      events: true,
    }) // full include AT EXECUTE — this is what makes the caller's wait skippable
    expect(res.digest).toBe('CERT')
    expect(res.effects_result).toBe(certified) // the caller reads certified effects — no waitForTransaction
  })

  test('EXECUTED failure ({FailedTransaction}) → RETURNED as effects_result, submitted exactly ONCE', async () => {
    sim.current = ok_sim('1000000', '2000000', '500000')
    const st = mock(async () => ({ signature: 'sig', bytes: 'AAAA' }))
    const failed = {
      FailedTransaction: { digest: 'BURNED', effects: { status: { success: false, error: { message: 'MoveAbort' } } } },
    }
    grpc.core.executeTransaction.mockImplementationOnce(async () => failed)
    const res = await execute_tx({
      wallet: make_cert_wallet(st),
      address: ADDR,
      transaction: make_tx(),
      chain: CHAIN,
      want_effects: true,
    })
    expect(res.digest).toBe('BURNED') // digest exists = gas burned — surfaced to the caller as a receipt…
    expect(res.effects_result).toBe(failed)
    expect(grpc.core.executeTransaction).toHaveBeenCalledTimes(1) // …and NEVER auto-retried (tx-retry-burn law)
  })

  test('wallet WITHOUT sign-only → falls back to the wallet-execute door, NO effects_result (caller waits)', async () => {
    sim.current = ok_sim('1000000', '2000000', '500000')
    const sae = mock(async () => ({ digest: 'WALLET' }))
    const res = await execute_tx({
      wallet: make_wallet(sae), // no sui:signTransaction feature
      address: ADDR,
      transaction: make_tx(),
      chain: CHAIN,
      want_effects: true,
    })
    expect(sae).toHaveBeenCalledTimes(1)
    expect(res.digest).toBe('WALLET')
    expect(res.effects_result).toBeUndefined()
  })

  test('want_effects ABSENT → byte-identical wallet-execute behavior (no gRPC execute, no effects_result)', async () => {
    sim.current = ok_sim('1000000', '2000000', '500000')
    const st = mock(async () => ({ signature: 'sig', bytes: 'AAAA' }))
    const sae = mock(async () => ({ digest: 'WALLET' }))
    const res = await execute_tx({
      wallet: make_cert_wallet(st, sae), // sign-only EXISTS — but the caller did not opt in
      address: ADDR,
      transaction: make_tx(),
      chain: CHAIN,
    })
    expect(st).toHaveBeenCalledTimes(0)
    expect(sae).toHaveBeenCalledTimes(1)
    expect(grpc.core.executeTransaction).toHaveBeenCalledTimes(0)
    expect(res.effects_result).toBeUndefined()
  })

  test('PRE-execution gRPC rejection (non-gas-selection) → thrown raw, ONE submit, sponsor untouched', async () => {
    sim.current = ok_sim('1000000', '2000000', '500000')
    const st = mock(async () => ({ signature: 'sig', bytes: 'AAAA' }))
    grpc.core.executeTransaction.mockImplementationOnce(async () => {
      throw new Error('Transaction is rejected as invalid by more than 1/3 of validators by stake (non-retriable)')
    })
    const deps = fallback_deps()
    await expect(
      execute_tx({
        wallet: make_cert_wallet(st),
        address: ADDR,
        transaction: make_tx(),
        chain: CHAIN,
        want_effects: true,
        sponsor_fallback: deps,
      })
    ).rejects.toThrow(/rejected as invalid/)
    expect(grpc.core.executeTransaction).toHaveBeenCalledTimes(1) // one submit, ZERO retries anywhere
    expect(deps.run_sponsored).toHaveBeenCalledTimes(0) // not the gas-selection class ⇒ sponsor never touched
  })
})

// TWO-CALL STATION FLOW (docs/SPONSOR_TWO_CALL_CONTRACT.md) — execute_sponsored_tx now RESERVES gas, applies it to
// the SAME tx object EXACTLY, dry-runs it (S-54), signs the SENDER half, and hands the wallet's signed bytes to
// /execute where the STATION co-signs the gas half + submits + returns certified effects. The CLIENT NEVER submits
// a sponsored tx. Fetch is mocked (reserve/execute routed by path); the sdk mock above supplies the simulate gate.
describe('execute_sponsored_tx — two-call station flow', () => {
  const RESERVATION = {
    reservationId: 42,
    sponsorAddress: '0xspon',
    gasCoins: [{ objectId: '0xg', version: '7', digest: 'gd' }],
    gasBudget: 3_000_000,
  }
  const make_spon_tx = (spy = {}) => ({
    setSenderIfNotSet() {},
    build: async () => new Uint8Array([1, 2, 3]), // offline kind-only bytes (reserve input)
    setSender(a) {
      spy.sender = a
    },
    setGasOwner(o) {
      spy.owner = o
    },
    setGasPayment(c) {
      spy.payment = c
    },
    setGasBudget(b) {
      spy.budget = b
    },
  })
  const make_spon_wallet = (st_spy = mock(async () => ({ signature: 'sender-sig', bytes: 'TXBYTES' }))) => ({
    features: {
      'sui:signPersonalMessage': { signPersonalMessage: mock(async () => ({ signature: 'zk-sig' })) },
      'sui:signTransaction': { signTransaction: st_spy },
      'enoki:getSession': { getSession: async () => ({}) }, // zkLogin marker — the sponsor door is zkLogin-only (#73)
    },
  })
  const ok_json = (body) => ({ ok: true, json: async () => body })
  const bad = (status, detail) => ({ ok: false, status, text: async () => detail })
  const route = ({ reserve, execute }) => {
    const spy = mock(async (url, init) => {
      if (String(url).endsWith('/reserve')) return reserve(init)
      if (String(url).endsWith('/execute')) return execute(init)
      throw new Error(`unexpected sponsor url ${url}`)
    })
    globalThis.fetch = spy
    return spy
  }
  const run = (tx = make_spon_tx(), wallet = make_spon_wallet()) =>
    execute_sponsored_tx({
      wallet,
      address: ADDR,
      transaction: tx,
      chain: CHAIN,
      sponsor_url: 'http://s.test/api/sponsor',
    })

  const real_fetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = real_fetch
  })

  test('happy path → reserve → apply reserved gas EXACTLY → dry-run → sign SENDER half → execute → consume effects', async () => {
    sim.current = ok_sim('1000000', '2000000', '500000')
    let execute_body = null
    globalThis.fetch = mock(async (url, init) => {
      if (String(url).endsWith('/reserve')) return ok_json(RESERVATION)
      execute_body = JSON.parse(init.body)
      return ok_json({ effects: { status: { status: 'success' }, transactionDigest: 'DIG' }, digest: 'DIG' })
    })
    const gas_spy = {}
    const res = await run(make_spon_tx(gas_spy))
    // the reserved gas is applied to the SAME tx byte-for-byte (fields — owner, coins, budget — all from /reserve)
    expect(gas_spy).toEqual({ sender: ADDR, owner: '0xspon', payment: RESERVATION.gasCoins, budget: 3_000_000 })
    expect(grpc.core.simulateTransaction).toHaveBeenCalledTimes(1) // the S-54 dry-run ran before signing
    // /execute carries the reservation id + the wallet's EXACT signed bytes + the sender sig (station submits)
    expect(execute_body).toEqual({ reservationId: 42, txBytes: 'TXBYTES', userSig: 'sender-sig' })
    expect(res.digest).toBe('DIG')
    expect(res.effects.status.status).toBe('success')
    expect(grpc.core.executeTransaction).toHaveBeenCalledTimes(0) // the CLIENT never submits a sponsored tx
  })

  test('EXECUTED failure → station effects consumed directly, the raw JSON-RPC abort string passes through', async () => {
    sim.current = ok_sim('1000000', '2000000', '500000')
    const abort = 'MoveAbort(MoveLocation { module: Identifier("creation") }, 101) in command 0'
    route({
      reserve: () => ok_json(RESERVATION),
      execute: () =>
        ok_json({
          effects: { status: { status: 'failure', error: abort }, transactionDigest: 'BURNED' },
          digest: 'BURNED',
        }),
    })
    const res = await run()
    expect(res.digest).toBe('BURNED') // a digest = gas burned — surfaced as a receipt, NEVER retried
    expect(res.effects.status.status).toBe('failure')
    expect(res.effects.status.error).toBe(abort) // the legacy string the shared decoder maps — unmodified
  })

  test('S-54 dry-run refuse → failure receipt (digest ""), /execute is NEVER called (zero sponsor gas)', async () => {
    sim.current = failed_sim()
    const spy = route({
      reserve: () => ok_json(RESERVATION),
      execute: () => {
        throw new Error('/execute must not be called on a would-fail tx')
      },
    })
    const res = await run()
    expect(res.digest).toBe('') // refused before signing/executing — nothing burned
    expect(res.effects.status.status).toBe('failure')
    expect(spy.mock.calls.filter((c) => String(c[0]).endsWith('/execute'))).toHaveLength(0)
  })

  test('reservation mismatch (execute 400 sponsor-tx-mismatch) → sponsor_retry, NOT a silent self-pay / cap', async () => {
    sim.current = ok_sim('1000000', '2000000', '500000')
    route({
      reserve: () => ok_json(RESERVATION),
      execute: () => bad(400, 'sponsor-tx-mismatch: gas budget does not match the reserved budget — refusing'),
    })
    const error = await run().then(
      () => null,
      (e) => e
    )
    expect(error).not.toBeNull()
    expect(error.message).toBe(i18n.t('errors.sponsor_retry'))
    expect(is_sponsor_self_pay_refusal(error)).toBe(false) // never the silent self-pay re-route
    expect(is_sponsor_daily_cap_refusal(error)).toBe(false) // nor the daily-cap block
  })
})
