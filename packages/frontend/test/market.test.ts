// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The market's money paths through the site's real store: what the socket observes, which offer a buy may take,
// what each wallet call receives, and how receipts, sales and proceeds fold.
import { afterEach, expect, test } from 'bun:test'
import { MARKET_PRICE_DAY_MS as DAY, type ListingRow, type MarketSaleRow, type MarketType } from '@aresrpg/protocol'
import { GAS_BUDGET_MIST } from '@aresrpg/sdk/gas-budget'

import { buyer_total } from '../src/marketplace/price.ts'
import {
  cheapest_offers,
  group_types,
  market_subject,
  rarest_type,
  unit_floor,
  unit_price_sui,
} from '../src/marketplace/market_browse.ts'
import { market_capitalization, price_points } from '../src/marketplace/price_history_model.ts'
import { SITE_MODULES } from '../src/site_modules.ts'

import { character_row, fake_wallet, settle, sign_in, start_surface, type Started } from './harness.ts'

const running: Started[] = []
const start_site = async (wallet = fake_wallet()): Promise<Started> => {
  const site = await start_surface(SITE_MODULES, { seat: false, account: { wallet } })
  running.push(site)
  return site
}
afterEach(() => running.splice(0).forEach(({ stop }) => stop()))

const offer = Object.freeze({
  version: '1',
  kind: 'item',
  id: '0xblade',
  name: 'Blade',
  item_type: 'aberrant_edge',
  category: 'sword',
  level: 80,
  amount: 1,
  price_mist: '1000000000',
  kiosk: '0xseller_kiosk',
  seller: '0xseller',
  at_ms: 10,
}) satisfies ListingRow
const sword = Object.freeze({ kind: 'offers', category: 'sword', item_type: 'aberrant_edge' } as const)
const sale = (id: string, price_mist: string): MarketSaleRow => ({
  id,
  object: '0xrune',
  kind: 'item',
  name: 'Rune PA Fo',
  item_type: 'rune_action_pa',
  amount: 1,
  price_mist,
  counterparty: '0xbuyer',
  ts_ms: Date.now(),
})
type Call = Readonly<{ operation: string; asset: unknown }>
const marketplace_hand = (calls: Call[], fail?: string) => {
  const record =
    (operation: string) =>
    async (asset: unknown): Promise<Readonly<{ digest: string; version: string }>> => {
      calls.push({ operation, asset })
      await settle()
      if (fail === operation) throw new Error(`${operation} refused by the chain`)
      return { digest: `0x${operation}`, version: '20' }
    }
  return { list: record('list'), delist: record('delist'), buy: record('buy'), collect: record('collect') }
}
const slice = (observation: unknown, listings: readonly ListingRow[], versions: Readonly<Record<string, string>>) => ({
  type: 'packet/market_slice',
  observation,
  next_cursor: null,
  listings,
  kiosk_versions: versions,
})

test('a buyer takes only the current offer, pays through the wallet once, and the receipt retires that offer', async () => {
  const calls: Call[] = []
  const site = await start_site(fake_wallet({ marketplace: marketplace_hand(calls) }))
  // Signed out, a buy starts the one sign-in and nothing waits on it.
  site.dispatch({ type: 'market/buy_requested', listing: offer })
  expect(site.state().session.sign_in.status).toBe('connecting')
  expect(site.state().marketplace.pending).toBeNull()
  const stack = {
    id: '0xstack',
    name: 'Blade',
    item_type: 'aberrant_edge',
    category: 'sword',
    level: 80,
    amount: 1,
    kiosk: '0xmine',
    version: '3',
  }
  await sign_in(site, { characters: [character_row('0xc1')], inventory: [stack] })

  site.dispatch({ type: 'market/observed', query: sword })
  const { observation } = site.state().marketplace
  expect(site.sent('packet/market_observe').at(-1)).toEqual({ type: 'packet/market_observe', observation })
  // Before the page arrives nothing is buyable.
  site.dispatch({ type: 'market/buy_requested', listing: offer })
  site.receive(slice(observation, [offer], { [offer.kiosk]: '1' }))
  expect(site.state().marketplace.listings).toEqual([offer])
  // An offer that differs from the page in price, amount or version is not the one on screen.
  site.dispatch({ type: 'market/buy_requested', listing: { ...offer, price_mist: '1' } })
  expect(calls).toEqual([])

  site.dispatch({ type: 'market/buy_requested', listing: offer })
  site.dispatch({ type: 'market/buy_requested', listing: offer })
  expect(site.state().marketplace.pending).toBe(offer.id)
  await settle(5)
  expect(calls).toHaveLength(1)
  expect(calls[0]).toEqual({
    operation: 'buy',
    asset: {
      kind: 'item',
      id: offer.id,
      kiosk: offer.kiosk,
      price_mist: 1_000_000_000n,
      amount: 1,
      source_amount: undefined,
      existing: null,
      destination_kiosk: null,
    },
  })
  expect(site.state().marketplace.pending).toBeNull()
  expect(site.toasts().map(({ type }) => type)).toEqual(expect.arrayContaining(['pending', 'success']))
  // The certified purchase is newer than the page's row: a late slice cannot bring it back, a relist elsewhere stays.
  site.receive(slice(observation, [offer], { [offer.kiosk]: '1' }))
  expect(site.state().marketplace.listings).toEqual([])
  const relist = { ...offer, kiosk: '0xother_kiosk', version: '20' }
  site.receive(slice(observation, [relist], { [offer.kiosk]: '20', [relist.kiosk]: '20' }))
  expect(site.state().marketplace.listings).toEqual([relist])

  // A buy the balance cannot cover with its royalty and gas opens the funding window for exactly that total.
  site.dispatch({ type: 'wallet/refreshed', balance_mist: 1_000_000n, kares_balance: null, gas_spent_mist: 0n })
  site.dispatch({ type: 'market/buy_requested', listing: relist })
  expect(site.state().funding).toEqual({ cost_mist: buyer_total(BigInt(relist.price_mist)), authorization: undefined })
  expect(buyer_total(1_000_000_000n) + GAS_BUDGET_MIST).toBeGreaterThan(1_000_000_000n)
  expect(calls).toHaveLength(1)
  site.dispatch({ type: 'funding/close' })

  // A hero bought onto a full roster would land unseen: it is refused before any transaction.
  site.receive({
    type: 'packet/characters',
    characters: ['1', '2', '3', '4', '5', '6'].map((id) => character_row(`0xc${id}`)),
  })
  site.dispatch({ type: 'wallet/refreshed', balance_mist: 900_000_000_000n, kares_balance: null, gas_spent_mist: 0n })
  const hero = { ...relist, kind: 'character' as const, id: '0xhero', item_type: null, category: null }
  site.dispatch({ type: 'market/buy_requested', listing: hero })
  expect(calls).toHaveLength(1)
  expect(site.toasts().at(-1)?.type).toBe('error')
})

test('a seller lists, delists into a stack and collects; a failed write frees the account and says why', async () => {
  const calls: Call[] = []
  const hand = marketplace_hand(calls)
  const failing = { ...hand, delist: marketplace_hand(calls, 'delist').delist }
  const wallet = fake_wallet({ marketplace: failing })
  const site = await start_site(wallet)
  const resin = {
    id: '0xresin',
    name: 'Resin',
    item_type: 'resin',
    category: 'resource',
    level: 1,
    amount: 5,
    kiosk: '0xmine',
    version: '2',
  }
  await sign_in(site, { inventory: [resin] })
  const listing = {
    ...offer,
    id: '0xresin_lot',
    item_type: 'resin',
    category: 'resource',
    amount: 3,
    kiosk: '0xmine',
    seller: wallet.address,
  }

  site.dispatch({ type: 'market/list_requested', listing, source_amount: 5, merge_sources: ['0xresin_dust'] })
  await settle(5)
  expect(calls[0]).toMatchObject({
    operation: 'list',
    asset: { kind: 'item', id: listing.id, amount: 3, source_amount: 5, merge_sources: ['0xresin_dust'] },
  })
  const listed = { ...listing, version: '20' }
  expect(site.state().marketplace.own_listings).toEqual([listed])
  // An older empty catalogue of the kiosk cannot erase the certified listing; a newer one can.
  site.receive({ type: 'packet/listings', listings: [], kiosk_versions: { '0xmine': '19' } })
  expect(site.state().marketplace.own_listings).toEqual([listed])

  // A delist returns the lot into the bag's stack of the same type; the chain refuses it this time.
  site.dispatch({ type: 'market/delist_requested', listing: listed })
  await settle(5)
  expect(calls[1]).toMatchObject({ operation: 'delist', asset: { existing: '0xresin', destination_kiosk: '0xmine' } })
  expect(site.state().marketplace.pending).toBeNull()
  // The raw chain failure reaches the player as a sentence, never as the exception.
  expect(site.toasts().at(-1)).toMatchObject({ type: 'error', message: 'The action could not be completed.' })
  site.receive({ type: 'packet/listings', listings: [], kiosk_versions: { '0xmine': '21' } })
  expect(site.state().marketplace.own_listings).toEqual([])

  // History and unclaimed proceeds arrive as one projection; a sale is said once however often it is pushed.
  site.receive({
    type: 'packet/market_history',
    sales: [],
    revenue_30d_mist: '0',
    total: 0,
    profits: [{ kiosk: '0xmine', amount_mist: '6' }],
  })
  const sold = sale('10:2:3', '2000000000')
  site.receive({ type: 'packet/listing_sold', sale: sold }, { type: 'packet/listing_sold', sale: sold })
  expect(site.state().marketplace).toMatchObject({ history_total: 1, revenue_30d_mist: '2000000000' })
  expect(site.toasts().filter(({ message }) => message === 'Sold ×1 Rune PA Fo for 2.00 SUI')).toHaveLength(1)
  site.dispatch({ type: 'market/collect_requested' })
  await settle(5)
  expect(calls[2]).toEqual({ operation: 'collect', asset: ['0xmine'] })
  expect(site.state().marketplace).toMatchObject({ profits: [], pending: null })
  // Signing out clears the account's market and keeps the public one.
  site.dispatch({ type: 'auth/disconnected' })
  await settle()
  expect(site.state().marketplace).toMatchObject({ own_listings: [], history: [], profits: [] })
})

test('the socket follows the view on screen: pages, stale replies, link losses and viewers', async () => {
  const site = await start_site()
  site.receive({ type: 'packet/connection_accepted', stage: 'open' })
  site.dispatch({ type: 'market/observed', query: { kind: 'types' } })
  const types: MarketType[] = [
    {
      item_type: 'wood',
      category: 'resource',
      name: 'Wood',
      level: 1,
      quote: { lots: { 10: '30' }, units: 10, change_bps: null },
    },
  ]
  site.receive({ type: 'packet/market_types', items: types })
  expect(site.state().marketplace.types).toEqual(types)

  site.dispatch({ type: 'market/observed', query: sword })
  const first = site.state().marketplace.observation
  site.receive({ ...slice(first, [offer], { [offer.kiosk]: '1' }), next_cursor: 'roll:next' })
  // The same query again keeps its page and its offers.
  site.dispatch({ type: 'market/observed', query: sword })
  expect(site.state().marketplace.observation).toBe(first)
  site.dispatch({ type: 'market/page_requested', direction: 'next' })
  const second = site.state().marketplace.observation
  expect(second).toMatchObject({ cursor: 'roll:next', request: 3 })
  expect(site.state().marketplace.listings).toEqual([])
  // A reply to the earlier page is refused; the reply to this one is taken.
  site.receive(slice(first, [offer], { [offer.kiosk]: '9' }))
  expect(site.state().marketplace.listings).toEqual([])
  const next_row = { ...offer, id: '0xnext', kiosk: '0xnext_kiosk' }
  site.receive(slice(second, [next_row], { [next_row.kiosk]: '1' }))
  expect(site.state().marketplace.listings).toEqual([next_row])
  site.dispatch({ type: 'market/page_requested', direction: 'previous' })
  expect(site.state().marketplace).toMatchObject({ observation: { cursor: '', request: 4 }, page_cursors: [] })

  // A lost link empties the live page but keeps the listed types; the next link asks for the same view again.
  site.dispatch({ type: 'link/failed', error: 'Connection lost' })
  expect(site.state().marketplace.listings).toEqual([])
  expect(site.state().marketplace.types).toEqual(types)
  // Another viewer asks again under a new request; leaving the view ends the observation.
  site.dispatch({ type: 'auth/disconnected' })
  expect(site.state().marketplace.observation).toMatchObject({ request: 5 })
  site.dispatch({ type: 'market/observed', query: null })
  expect(site.state().marketplace.observation).toBeNull()
  // The price chart on screen is observed with the page, and closing it sends null.
  site.dispatch({ type: 'link/connecting' })
  site.receive({ type: 'packet/connection_accepted', stage: 'open' })
  site.dispatch({ type: 'market/price_item_selected', item_type: 'wood' })
  const prices = site.state().marketplace.prices.observation
  expect(site.sent('packet/market_prices_observe').at(-1)).toEqual({
    type: 'packet/market_prices_observe',
    observation: prices,
  })
  const history = {
    first_timestamp_ms: 100 * DAY,
    sampled_at_ms: 101 * DAY,
    buckets: [{ at_ms: 100 * DAY, total_mist: '7', units: '3', sales: '1', checkpoint: 1 }],
  }
  site.receive({ type: 'packet/market_prices', observation: prices, history, total_units: '42' })
  expect(site.state().marketplace.prices.read).toEqual({ status: 'read', history, total_units: '42' })
  site.dispatch({ type: 'market/price_item_selected', item_type: null })
  expect(site.sent('packet/market_prices_observe').at(-1)).toEqual({
    type: 'packet/market_prices_observe',
    observation: null,
  })
})

test('prices: the unit floor, the cheapest offer per group, candles and capitalization stay exact past Number', () => {
  const lots = (record: Readonly<Record<string, string>>) => ({ lots: record, units: 900, change_bps: null })
  // Twelve a unit for ten is cheaper than fifteen for one and thirteen a unit for a hundred.
  expect(unit_floor(lots({ 1: '15', 10: '120', 100: '1300' }))).toEqual({ mist: '120', units: '10' })
  expect(unit_floor(lots({ 1: '9007199254740993', 10: '90071992547409920' }))).toEqual({
    mist: '90071992547409920',
    units: '10',
  })
  expect(unit_floor(lots({}))).toBeNull()
  expect(unit_price_sui(lots({ 10: '120' }))).toBe(Number(buyer_total(120n)) / 10 / 1e9)
  const rows: ListingRow[] = [
    { ...offer, id: 'backup', group_key: 'roll:a', price_mist: '9007199254740993' },
    { ...offer, id: 'best', group_key: 'roll:a', price_mist: '9007199254740992' },
    { ...offer, id: 'other_roll', group_key: 'roll:b', price_mist: '1' },
    { ...offer, id: 'ungrouped', price_mist: '2' },
  ]
  expect(cheapest_offers(rows).map(({ id }) => id)).toEqual(['other_roll', 'ungrouped', 'best'])
  expect(cheapest_offers(rows.filter(({ id }) => id !== 'best')).at(-1)?.id).toBe('backup')
  const type = (item_type: string, category: MarketType['category'], units: number, priced = true): MarketType => ({
    item_type,
    category,
    name: item_type,
    level: 30,
    quote: { lots: priced ? { 1: '5' } : {}, units, change_bps: null },
  })
  const listed = [
    type('wolf_cloak', 'cloak', 1),
    type('ash_cloak', 'cloak', 1),
    type('old_cloak', 'cloak', 1, false),
    type('iron_hat', 'hat', 4),
  ]
  expect(rarest_type(listed)?.item_type).toBe('ash_cloak')
  expect(group_types(listed, 'EQUIPMENT', 'hat').map(({ item_type }) => item_type)).toEqual(['iron_hat'])
  expect(market_subject({ item_type: 'wolf_cloak', category: 'cloak' }, false)).toEqual({
    kind: 'offers',
    category: 'cloak',
    item_type: 'wolf_cloak',
  })
  expect(market_subject(undefined, true)).toEqual({ kind: 'characters' })
  const ratio = (mist: string, units: string) => ({ mist, units })
  const bucket = { at_ms: 100 * DAY, total_mist: '7', units: '3', sales: '1', checkpoint: 1 }
  const history = { first_timestamp_ms: 100 * DAY + 1, sampled_at_ms: 106 * DAY + 1, buckets: [bucket] }
  const candle = {
    ...bucket,
    ohlc: {
      open: ratio('1000000000', '10'),
      high: ratio('3000000000', '10'),
      low: ratio('2000000000', '100'),
      close: ratio('2500000000', '10'),
    },
  }
  expect(price_points({ ...history, buckets: [candle] }, 7)[0]!.candle).toEqual({
    open: 0.1,
    high: 0.3,
    low: 0.02,
    close: 0.25,
  })
  expect(market_capitalization(history, '9007199254740993')).toBe((9007199254740993n * 7n) / 3n)
  expect(market_capitalization(null, '42')).toBeNull()
})
