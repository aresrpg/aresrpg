// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// KARES money on the staking page: stakes and payments through the finance runtime, the Mastery shop, and the exact
// amounts and gains they show.
import { afterEach, expect, test } from 'bun:test'
import { KaresSnapshotPending } from '@aresrpg/sdk/kares'
import { KARES_SUPPLY, KARES_UNIT } from '@aresrpg/sdk/kares-economics'
import { kares_price_sui } from '@aresrpg/sdk/kares-market'

import type { AuthSession } from '../src/auth.ts'
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
import { daily_usd, staking_apr, staking_gains, staking_preset } from '../src/kares/staking_model.ts'
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
  // The staked share is a fraction of the current supply.
  expect(
    tokenomics_reading(loaded({ ...live, total_supply: 1_000n, pool: { ...live.pool, total_staked: 125n } }))
      .staked_share
  ).toBe(0.125)
  expect(tokenomics_reading(initial_finance()).staked_share).toBeNull()
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
  // A year at today's rates, both rewards valued in SUI: 1,000 KARES a day on 100,000 staked is 3.65 a year, and
  // SUI rewards worth as much again double it. No price, or an empty pool, has no rate.
  const staked = { total_staked: 100_000n * KARES_UNIT, daily_kares: 1_000n * KARES_UNIT, daily_sui: 0n }
  const market = { sui: 1_000n * SUI, kares: 400_000n * KARES_UNIT }
  const price = kares_price_sui(market)!
  expect(staking_apr(staked, market)).toBeCloseTo(3.65, 9)
  expect(staking_apr({ ...staked, daily_sui: BigInt(Math.round(1_000 * price * 1e9)) }, market)).toBeCloseTo(7.3, 6)
  expect([staking_apr(staked, null), staking_apr({ ...staked, total_staked: 0n }, market)]).toEqual([null, null])
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
        if (redeemed.length === 1) throw new Error('Purchase rejected')
        return { mastery: null }
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
  // A purchase that lands opens the shop's window on what was bought, and closing it forgets the purchase.
  site.dispatch({ type: 'mastery/redeem', item_type: 'reward', payment: 'kares', count: 3 })
  await settle(5)
  expect(site.state().mastery).toMatchObject({ pending: null, purchased: { item_type: 'reward', count: 3 } })
  site.dispatch({ type: 'mastery/purchase_closed' })
  expect(site.state().mastery.purchased).toBeNull()
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
