// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// KARES money on the staking page: stakes and payments through the finance runtime, the allocation sale through
// its runtime, the public sale reader, and the exact amounts and gains they show.
import { afterEach, expect, test } from 'bun:test'
import { KaresSnapshotPending } from '@aresrpg/sdk/kares'
import { KARES_SUPPLY, KARES_UNIT } from '@aresrpg/sdk/kares-economics'

import {
  buy_check,
  buy_limits,
  create_sale_runtime,
  initial_sale,
  reduce_sale,
  spot_stage,
} from '../src/allocation/sale.ts'
import type { AuthSession } from '../src/auth.ts'
import { blast_phase, create_blast_runtime, initial_blast_state, reduce_blast } from '../src/kares/blast.ts'
import {
  failed_transaction,
  initial_finance,
  parse_amount,
  reduce_finance,
  validate_amount,
  type FinanceSession,
  type FinanceSnapshot,
  type FinanceState,
} from '../src/kares/model.ts'
import { create_finance_runtime } from '../src/kares/runtime.ts'
import { daily_usd, staking_gains, staking_preset } from '../src/kares/staking_model.ts'
import { market_reading, tokenomics_reading } from '../src/kares/tokenomics.ts'
import { encyclopedia_catalog } from '../src/content/catalog.ts'
import { mastery_offers } from '../src/content/mastery.ts'
import { docs_view } from '../src/docs/routes.ts'
import { offer_view } from '../src/mastery/model.ts'
import { SITE_MODULES } from '../src/site_modules.ts'

import { fake_wallet, settle, sign_in, start_surface, type Started } from './harness.ts'

const SUI = 1_000_000_000n
const snapshot = (): FinanceSnapshot => ({
  network: 'testnet',
  address: '0xparticipant',
  clock_ms: 150n,
  combat_pot: {
    authorized: '0x1::fight_rewards::BossVictory',
    id: '0xcombat',
    version: '1',
    balance: 0n,
    quota: 20_000n,
    spent: 0n,
  },
  coin_type: '0x99::token::TOKEN',
  market: null,
  total_supply: KARES_SUPPLY,
  community: {
    id: '0xcommunity',
    version: '1',
    started_ms: 0n,
    remaining: 110_000_000n * KARES_UNIT,
    claimable: 0n,
    treasury: '0xtreasury',
  },
  pool: {
    id: '0xpool',
    version: '1',
    active: true,
    total_staked: 100n * KARES_UNIT,
    active_ms: 100n,
    initial_remaining: 200_000n * KARES_UNIT,
    kares_rewards: 0n,
    sui_rewards: 0n,
    daily_kares: 5_000_000_000n,
    daily_sui: 2_500_000_000n,
  },
  positions: [
    { id: '0xstake', version: '1', amount: 10n * KARES_UNIT, pending_kares: KARES_UNIT, pending_sui: 2n * KARES_UNIT },
  ],
})
const loaded = (from = snapshot()): FinanceState => ({
  ...initial_finance(from.address),
  snapshot: from,
  balances: { kares_balance: 7n * KARES_UNIT, sui_balance: 9n * KARES_UNIT },
})
const stake = (amount: bigint) =>
  ({ type: 'request', request: { kind: 'execute', action: { kind: 'stake', amount } } }) as const

test('a stake signs once; a lagging ownership read is retried, never the transaction', async () => {
  let reads = 0
  let submissions = 0
  const session: FinanceSession = {
    address: '0xparticipant',
    kares: {
      snapshot: async () => {
        reads += 1
        if (reads === 2) throw new KaresSnapshotPending('KARES ownership snapshot is behind a certified transaction')
        return { ...snapshot(), kares_balance: 7n, sui_balance: 9n }
      },
      stake: async () => {
        submissions += 1
        return { digest: 'certified-stake', receipt: {} }
      },
    } as never,
  }
  const runtime = create_finance_runtime({ network: 'testnet' }, session)
  const stop = runtime.start()
  try {
    await Bun.sleep(0)
    runtime.dispatch(stake(1n))
    runtime.dispatch(stake(1n))
    await Bun.sleep(400)
    expect(runtime.store.getState()).toMatchObject({ digest: 'certified-stake', error: null, snapshot: snapshot() })
    expect(submissions).toBe(1)
    expect(reads).toBe(3)
  } finally {
    stop()
  }
  // A stopped owner's late read never reaches its replacement.
  const late = Promise.withResolvers<FinanceSnapshot>()
  const old = create_finance_runtime(
    { network: 'testnet', managed: true },
    { ...session, kares: { staking_snapshot: () => late.promise } as never }
  )
  old.start()()
  late.resolve(snapshot())
  await Bun.sleep(0)
  expect(old.store.getState().snapshot).toBeNull()
})

test('a certified payment keeps its digest, blocks another write until re-read, and is said once when it fails', () => {
  const pending = reduce_finance(loaded(), {
    type: 'request',
    request: { kind: 'execute', action: { kind: 'fund_sui', amount: 1n } },
  })
  expect(reduce_finance(pending, stake(1n))).toBe(pending)
  const certified = reduce_finance(pending, { type: 'receipt', sequence: pending.sequence, digest: 'paid-once' })
  expect(certified.snapshot).toBeNull()
  const unread = reduce_finance(certified, { type: 'failed', sequence: pending.sequence, error: 'read unavailable' })
  expect(unread).toMatchObject({ digest: 'paid-once', snapshot: null, request: null })
  expect(reduce_finance(unread, stake(1n))).toBe(unread)
  expect(reduce_finance(unread, { type: 'request', request: { kind: 'refresh' } }).digest).toBe('paid-once')
  // A new payment never inherits the previous success.
  const next = reduce_finance({ ...loaded(), digest: 'previous' }, stake(1n))
  expect(next.digest).toBeNull()
  // A resumed lifecycle refuses the abandoned read and replays nothing.
  const resumed = reduce_finance(next, { type: 'resume' })
  expect(resumed.request).toEqual({ kind: 'refresh' })
  expect(
    reduce_finance(resumed, { type: 'snapshot', balances: null, sequence: next.sequence, snapshot: snapshot() })
  ).toBe(resumed)
  // A transaction refused before its receipt is said once; a failed read is not a failed transaction.
  const action = { kind: 'claim_rewards', ids: ['0xstake'] } as const
  const executing = reduce_finance(loaded(), { type: 'request', request: { kind: 'execute', action } })
  const refused = reduce_finance(executing, { type: 'failed', sequence: executing.sequence, error: 'rejected' })
  expect(failed_transaction(refused, executing)).toBe('rejected')
  expect(failed_transaction(refused, refused)).toBeNull()
  const refreshing = reduce_finance(loaded(), { type: 'request', request: { kind: 'refresh' } })
  expect(
    failed_transaction(
      reduce_finance(refreshing, { type: 'failed', sequence: refreshing.sequence, error: 'offline' }),
      refreshing
    )
  ).toBeNull()
  // The supply shown is a reading: unknown is never zero, and burned supply needs a valid range.
  expect(tokenomics_reading({ ...initial_finance(), error: 'KARES currency is not configured' })).toMatchObject({
    phase: 'unavailable',
    burned: null,
  })
  expect(
    tokenomics_reading(
      reduce_finance(initial_finance(), { type: 'snapshot', sequence: 0, snapshot: null, balances: null })
    ).phase
  ).toBe('pre_funding')
  expect(tokenomics_reading(loaded({ ...snapshot(), total_supply: KARES_SUPPLY - 7n })).burned).toBe(7n)
  expect(tokenomics_reading(loaded({ ...snapshot(), total_supply: KARES_SUPPLY + 1n })).burned).toBeNull()
  // Circulating is what holders own: the supply minus what the reward pools still hold. Staked KARES counts.
  const live = snapshot()
  expect(tokenomics_reading(loaded(live)).circulating).toBe(
    live.total_supply - live.pool.kares_rewards - live.combat_pot.balance - live.community.remaining
  )
  expect(tokenomics_reading(initial_finance()).circulating).toBeNull()
  // The launch state of the real pool: 1,000 SUI and 540M KARES at 80/20 price one KARES at 0.0000074 SUI.
  const market = { sui: 1_000n * KARES_UNIT, kares: 540_000_000n * KARES_UNIT }
  const worth = daily_usd({ kares: 100_000n * KARES_UNIT, sui: 2n * KARES_UNIT }, market, 0.5)
  expect([worth.kares!.toFixed(4), worth.sui]).toEqual(['0.3704', 1])
  expect(daily_usd({ kares: 1n, sui: 1n }, null, 0.5)).toEqual({ kares: null, sui: 0.5e-9 })
  expect(daily_usd({ kares: 1n, sui: 1n }, market, null)).toEqual({ kares: null, sui: null })
  // At that price and SUI at $0.50, one billion KARES are worth $3,703.70 fully diluted.
  const priced = market_reading({ snapshot: { ...live, market }, circulating: 590_000_000n * KARES_UNIT }, 0.5)
  expect([priced.price!.toExponential(4), priced.fdv!.toFixed(2), priced.market_cap!.toFixed(2)]).toEqual([
    '3.7037e-6',
    '3703.70',
    '2185.19',
  ])
  expect(market_reading({ snapshot: live, circulating: 1n }, 0.5)).toEqual({ price: null, fdv: null, market_cap: null })
  expect(market_reading({ snapshot: { ...live, market }, circulating: null }, 0.5).market_cap).toBeNull()
  expect(market_reading({ snapshot: { ...live, market }, circulating: 1n }, null).fdv).toBeNull()
})

test('amounts and gains are exact base units: parsing, presets and dilution', () => {
  expect(parse_amount('9007199.254740993')).toBe(9_007_199_254_740_993n)
  expect(parse_amount('18446744073.709551615')).toBe(18_446_744_073_709_551_615n)
  for (const refused of ['0', '-1', '1e3', 'NaN', '.5', '0.0000000001', '18446744073.709551616'])
    expect(parse_amount(refused)).toBeNull()
  expect(validate_amount('abc', 10n)).toEqual({ amount: null, error: 'amount_invalid' })
  expect(validate_amount('1', 10n)).toEqual({ amount: null, error: 'insufficient' })
  expect(validate_amount('0.000000001', 10n)).toEqual({ amount: 1n, error: null })
  expect(staking_preset(9_007_199_254_740_993n, 25)).toBe('2251799.813685248')
  expect(staking_preset(1_000_000_001n, 50)).toBe('0.500000000')
  // More stake dilutes the pool: the added gain is not the old rate multiplied.
  const base = snapshot()
  const pool = {
    ...base,
    pool: { ...base.pool, total_staked: 100n, daily_kares: 1_000n, daily_sui: 100n },
    positions: [{ ...base.positions[0]!, amount: 25n }],
  }
  expect(staking_gains(pool, 25n)).toMatchObject({
    stake: 25n,
    kares: 250n,
    sui: 25n,
    additional_kares: 150n,
    additional_sui: 15n,
  })
  expect(staking_gains({ ...pool, pool: { ...pool.pool, total_staked: 0n }, positions: [] }, 1n)).toMatchObject({
    additional_kares: 1_000n,
  })
})

test('the allocation sale buys once with the allowlist proof, inside the spot and the wallet, then re-reads it', async () => {
  const cap = 125n * SUI
  const proof = { index: '3', cap_mist: String(cap), siblings: ['ab'.repeat(32)] }
  expect(spot_stage('live', { quote: 40n * SUI, wallet_cap: cap }, cap)).toBe('live')
  expect(spot_stage('live', { quote: cap, wallet_cap: cap }, cap)).toBe('full')
  expect(spot_stage('complete', undefined, cap)).toBe('checking')
  expect(spot_stage('cancelled', { quote: 1n, wallet_cap: cap }, cap)).toBe('claim')
  // Max stays inside both the spot and the wallet after its gas cushion; a short amount names what is missing.
  const limits = buy_limits(cap, 40n * SUI, (2040n * SUI) / 100n)
  expect(limits.max).toBe((2020n * SUI) / 100n)
  expect(buy_limits(cap, 40n * SUI, (21240n * SUI) / 100n)).toMatchObject({
    max: 85n * SUI,
    presets: [10n * SUI, 25n * SUI, 50n * SUI],
  })
  expect(buy_check(86n * SUI, limits)).toEqual({ kind: 'over_cap' })
  expect(buy_check(85n * SUI, limits)).toEqual({ kind: 'short', missing: 85n * SUI - (2020n * SUI) / 100n })
  expect(buy_check(20n * SUI, limits)).toEqual({ kind: 'ready' })

  const purchases: unknown[] = []
  const reads: string[] = []
  const wallet = {
    address: '0xa1',
    read_sui_balance: async () => 7n * SUI,
    blast: {
      purchase: async (input: unknown) => {
        purchases.push(input)
        return { digest: 'buy-digest' }
      },
      claim: async () => ({ digest: 'claim' }),
    },
  } as unknown as AuthSession
  // One task at a time, and a stale result cannot overwrite the current one.
  const busy = reduce_sale(initial_sale(), { type: 'request', task: { kind: 'buy', wallet, amount: SUI, proof } })
  expect(reduce_sale(busy, { type: 'request', task: { kind: 'claim', wallet } })).toBe(busy)
  expect(
    reduce_sale(busy, { type: 'result', sequence: 0, receipt: null, error: { address: '0xa1', message: 'x' } })
  ).toBe(busy)
  const runtime = create_sale_runtime({
    commitment: async (address) => {
      reads.push(address)
      return { quote: 45n * SUI, wallet_cap: cap }
    },
  })
  const stop = runtime.start()
  runtime.dispatch({ type: 'request', task: { kind: 'buy', wallet, amount: 45n * SUI, proof } })
  await Bun.sleep(0)
  await Bun.sleep(0)
  stop()
  expect(purchases).toEqual([{ method: 'allowlisted', amount: 45n * SUI, proof }])
  expect(runtime.store.getState()).toMatchObject({
    receipt: { kind: 'buy', address: '0xa1', amount: 45n * SUI, digest: 'buy-digest' },
    commitments: { '0xa1': { quote: 45n * SUI, wallet_cap: cap } },
    balances: { '0xa1': 7n * SUI },
  })
  expect(reads).toEqual(['0xa1'])
  // A failed read stays unknown, never zero bought.
  const offline = create_sale_runtime({ commitment: async () => Promise.reject(new Error('rpc down')) })
  await offline.refresh(['0xa1'], [])
  expect(offline.store.getState().commitments).toEqual({})
})

test('the public sale reader never rewinds certified progress and hides it when a read fails', async () => {
  const live = {
    version: '5',
    clock_ms: 100n,
    phase: 'live' as const,
    committed: 75n,
    target: 100n,
    progress_bps: 7500,
    start_ms: 0n,
    end_ms: 200n,
    token_allocation: 1000n,
  }
  const url = 'https://www.blast.fun/'
  const state = reduce_blast(initial_blast_state(), { type: 'snapshot', url, snapshot: live })
  expect(
    reduce_blast(state, { type: 'snapshot', url, snapshot: { ...live, version: '4', committed: 0n } }).snapshot
  ).toEqual(live)
  const failed = reduce_blast(state, { type: 'failed', url })
  expect(blast_phase(failed)).toBe('unavailable')
  expect(blast_phase(reduce_blast(failed, { type: 'snapshot', url, snapshot: { ...live, version: '4' } }))).toBe(
    'unavailable'
  )
  const ended = reduce_blast(initial_blast_state(), {
    type: 'snapshot',
    url,
    snapshot: { ...live, phase: 'closing', clock_ms: 200n },
  })
  expect(reduce_blast(ended, { type: 'snapshot', url, snapshot: live }).snapshot?.phase).toBe('closing')
  // Two consumers share one reader; a stopped reader drops its late result.
  let reads = 0
  let finish: (value: typeof live) => void = () => undefined
  const runtime = create_blast_runtime({ network: 'testnet' }, () => ({
    configured: true,
    url,
    read: () => {
      reads += 1
      return new Promise((resolve) => {
        finish = resolve
      })
    },
  }))
  const card = runtime.start()
  const dialog = runtime.start()
  card()
  finish(live)
  await Promise.resolve()
  expect(reads).toBe(1)
  expect(runtime.store.getState().snapshot).toEqual(live)
  dialog()
  const before = runtime.store.getState()
  finish({ ...live, version: '9' })
  await Promise.resolve()
  expect(runtime.store.getState()).toBe(before)
})

const running: Started[] = []
afterEach(() => running.splice(0).forEach(({ stop }) => stop()))

test('the Mastery shop redeems once per gesture, says the outcome, and an old account cannot touch the next one', async () => {
  const redeemed: unknown[] = []
  const gate = Promise.withResolvers<void>()
  const wallet = fake_wallet({
    mastery: {
      redeem: async (args: unknown) => {
        redeemed.push(args)
        await gate.promise
        throw new Error('Purchase rejected')
      },
    },
  })
  const site = await start_surface(SITE_MODULES, { seat: false, account: { wallet } })
  running.push(site)
  await sign_in(site)
  site.receive({
    type: 'packet/mastery',
    mastery: null,
    offers: [{ id: 'offer', template: 'template', item_type: 'reward', cost: '2', enabled: true }],
  })
  site.dispatch({ type: 'mastery/redeem', item_type: 'reward', payment: 'kares' })
  site.dispatch({ type: 'mastery/redeem', item_type: 'reward', payment: 'kares' })
  await settle()
  expect(redeemed).toHaveLength(1)
  expect(site.state().mastery.pending).toBe('redeem:reward')
  gate.resolve()
  await settle(5)
  expect(site.state().mastery.pending).toBeNull()
  expect(site.toasts().at(-1)).toMatchObject({ type: 'error' })
  // A purchase still running when the account signs out never writes into the next session.
  const late = Promise.withResolvers<void>()
  const next = fake_wallet({ mastery: { redeem: async () => (await late.promise, { mastery: { points: '9' } }) } })
  const other = await start_surface(SITE_MODULES, { seat: false, account: { wallet: next } })
  running.push(other)
  await sign_in(other)
  other.receive({
    type: 'packet/mastery',
    mastery: null,
    offers: [{ id: 'offer', template: 'template', item_type: 'reward', cost: '2', enabled: true }],
  })
  other.dispatch({ type: 'mastery/redeem', item_type: 'reward', payment: 'mastery' })
  other.dispatch({ type: 'auth/disconnected' })
  late.resolve()
  await settle(5)
  expect(other.state().mastery.row).toBeNull()
})

test('every Mastery offer opens its docs page, and a crate lists what it holds, each with its docs page', () => {
  const docs_item = (item_type: string) =>
    ({ kind: 'reference', section: 'items', id: item_type, place: null }) as const
  const crates = mastery_offers.filter(({ item }) => item?.consumable?.type === 'loot_box')
  expect(crates.map(({ item_type }) => item_type)).toEqual(['food_crate', 'resource_crate', 'pet_crate', 'sui_crate'])
  for (const { item_type } of mastery_offers) {
    const view = offer_view(item_type)
    // The docs router reads the address back to the same item, and the docs' item list has it.
    for (const link of [{ item_type, href: view.href }, ...(view.contents ?? [])]) {
      expect(docs_view(link.href)).toEqual(docs_item(link.item_type))
      expect(encyclopedia_catalog.item(link.item_type)).not.toBeNull()
    }
  }
  // A crate shows its contents with the chance of each; an item that is no crate has none to show.
  for (const { item_type } of crates) {
    const contents = offer_view(item_type).contents!
    expect(contents.length).toBeGreaterThan(0)
    expect(contents.reduce((sum, { percent }) => sum + percent, 0)).toBeCloseTo(100)
  }
  expect(offer_view('scroll_of_oblivion').contents).toBeNull()
})

test('an older sale read never replaces a newer one', async () => {
  const answers: ((value: Readonly<{ quote: bigint; wallet_cap: bigint }> | null) => void)[] = []
  const runtime = create_sale_runtime({ commitment: () => new Promise((resolve) => void answers.push(resolve)) })
  const older = runtime.refresh(['0xa1'], [])
  const newer = runtime.refresh(['0xa1'], [])
  answers[1]!({ quote: 45n * SUI, wallet_cap: 125n * SUI })
  await newer
  answers[0]!({ quote: 10n * SUI, wallet_cap: 125n * SUI })
  await older
  expect(runtime.store.getState().commitments['0xa1']?.quote).toBe(45n * SUI)
})
