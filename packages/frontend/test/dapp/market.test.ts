// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { ListingRow } from '@aresrpg/protocol'

import { market_input } from '../../src/dapp/DappMarket.tsx'
import { bot_market } from '../../src/dapp/market.ts'
import type { StartSpec } from '../../src/dapp/strategies.ts'
import {
  activity_offer,
  commands_unresolved,
  initial_dapp_state,
  reduce_dapp,
  type DappInput,
  type DappState,
} from '../../src/dapp/state.ts'
import { initial_marketplace_state } from '../../src/modules/marketplace.ts'
import { buyer_total } from '../../src/marketplace/price.ts'
import type { DappAccount } from '../../src/dapp/account.ts'

import {
  HERO,
  account_fixture,
  character_fixture,
  hero_id,
  item_fixture,
  listing_fixture,
  observation_fixture,
  run_fixture,
} from './fixtures.ts'

const SECOND = hero_id('2')
const KEY = 'key_of_gilded_lorito'
const AGENT = '0xagent'
const team = [character_fixture(), character_fixture({ id: SECOND, name: 'Bran', level: 7 })]
const offer = listing_fixture(KEY, '1000000000') as unknown as ListingRow
/** The reducer reads the account the game socket pushes; each test names the account it folds under. */
const fold_under =
  (account: DappAccount) =>
  (state: DappState, ...inputs: readonly DappInput[]) =>
    inputs.reduce((next, input) => reduce_dapp(next, input, account), state)
const bag = (keys: number, more: Parameters<typeof account_fixture>[0] = {}) =>
  account_fixture({ characters: team, items: keys ? [item_fixture(KEY, keys)] : [], ...more })
const ACCOUNT = bag(0)
const fold = fold_under(ACCOUNT)
const observed = (overrides: Readonly<Record<string, unknown>>, requested_ms: number): DappInput => ({
  type: 'dapp/observed',
  observation: observation_fixture(overrides),
  requested_ms,
  now: requested_ms,
})
const connected = fold(initial_dapp_state(), { type: 'dapp/link', link: { phase: 'connected' } }, observed({}, 100))
const buy = (id = 'o1', listing = offer): DappInput => ({ type: 'dapp/buy', id, listing })
const sent = (id: string, kind: 'done' | 'uncertain', now: number): DappInput => ({
  type: 'dapp/direct_sent',
  id,
  outcome: { kind },
  now,
})
/** The bot's own command for a request, as its observation lists it. */
const command = (state: DappState, status: string, error?: string) => ({
  id: 'bot-command',
  kind: state.direct!.action,
  status,
  error,
  payload: state.direct!.payload,
})
const RAID: StartSpec = {
  activity: 'raid',
  hero_ids: [SECOND, HERO],
  dungeon: 'gilded_lorito',
  runs: null,
  fee_cap_mist: null,
}

test('the market is the bot account: its bag, balance and listings, over the public offers on screen', () => {
  const own = listing_fixture('copper_ore', '5', { id: 'own', seller: AGENT })
  const account = bag(2, { listings: [own] })
  const state = fold_under(account)(connected, observed({ observation_revision: 11 }, 200))
  const live = {
    ...initial_marketplace_state(),
    history_total: 4,
    own_listings: [offer],
    pending: 'player-write',
    // The offers of the item on screen, as this page's own game socket pushed them.
    observation: { kind: 'offers' as const, category: 'key' as const, item_type: KEY, request: 9 },
    listings: [offer],
    ready_request: 9,
  }
  const source = bot_market({ account, address: AGENT }, state.direct, live)
  expect(source.account).toEqual({
    inventory: [item_fixture(KEY, 2)],
    characters: [],
    wallet: { address: AGENT },
    sui_balance_mist: 2_000_000_000n,
  })
  // Nothing of the signed-in player's own account is shown: not its listings, history or pending write.
  expect(source.market).toMatchObject({ own_listings: [own], history_total: 0, pending: null })
  // The offers are the public ones: the bot reads them again itself before it buys one.
  expect(source.market).toMatchObject({ listings: [offer], ready_request: 9 })
  // The bot withdraws its own item listings; character trades and the sales ledger are not offered.
  expect(source.capabilities).toEqual({ characters: false, withdraw: true, history: false })
})

test('a purchase is one order with the shown total as its ceiling; a second tap changes nothing', () => {
  const ordering = fold(connected, buy())
  expect(ordering.direct).toMatchObject({
    id: 'o1',
    action: 'market_buy',
    status: 'pending',
    hero_id: null,
    item_type: KEY,
    amount: 1,
    // Only the bot's own command proves a purchase.
    proof: null,
  })
  expect(ordering.direct!.payload).toEqual({
    character_id: SECOND,
    item_id: offer.id,
    seller_kiosk: offer.kiosk,
    listing_version: '5',
    item_type: KEY,
    amount: 1,
    price_mist: '1000000000',
    max_total_mist: String(buyer_total(1_000_000_000n)),
  })
  expect(fold(ordering, buy('o2'))).toBe(ordering)
  expect(
    bot_market({ account: ACCOUNT, address: AGENT }, ordering.direct, initial_marketplace_state()).market.pending
  ).toBe('o1')
  // The order is unresolved money: the page neither disconnects nor sends a stat change meanwhile.
  expect(commands_unresolved(ordering)).toBe(true)
  expect(fold(ordering, { type: 'dapp/disconnect' })).toBe(ordering)
  const edit: DappInput = { type: 'dapp/hero_direct', id: 'h', hero_id: HERO, action: 'raise_spell', payload: {} }
  expect(fold(ordering, edit)).toBe(ordering)
  expect(fold(ordering, { type: 'dapp/direct_dismissed' })).toBe(ordering)
})

test('an order the bot would refuse is refused before it is sent, with the reason', () => {
  const refused = (account: DappAccount, listing = offer) => fold_under(account)(connected, buy('o1', listing)).direct
  const poor = bag(0, { balance_mist: 5n })
  expect(refused(poor)).toMatchObject({ status: 'refused', error: 'insufficient_funds' })
  // An offer that changed is the bot's to refuse: it reads the item's offers again before it signs.
  expect(refused(ACCOUNT, { ...offer, price_mist: '999' })).toMatchObject({ status: 'pending', error: null })
  expect(refused(ACCOUNT, { ...offer, item_type: null })).toMatchObject({
    status: 'refused',
    error: 'listing_changed_or_ineligible',
  })
  const fighting = team.map((row) => ({ ...row, custody: 'fight' as const, active_fight: { id: 'f1', seat: 0 } }))
  expect(refused(bag(0, { characters: fighting }))).toMatchObject({
    status: 'refused',
    error: 'character_not_available',
  })
  // A refusal is only a message: it is dismissed, or replaced by the next order once the wallet is funded.
  const again = fold(fold_under(poor)(connected, buy()), observed({ observation_revision: 12 }, 300), buy('o2'))
  expect(again.direct).toMatchObject({ id: 'o2', status: 'pending' })
  expect(fold_under(poor)(connected, buy(), { type: 'dapp/direct_dismissed' }).direct).toBeNull()
})

test('the bot answers an order once; its observations then say bought, refused or still unknown', () => {
  const accepted = fold(connected, buy(), sent('o1', 'done', 300))
  expect(accepted.direct!.status).toBe('accepted')
  // An observation requested before the answer proves nothing about it.
  expect(fold(accepted, observed({ observation_revision: 11 }, 250)).direct).toBe(accepted.direct)
  const at = (status: string, error?: string) =>
    fold(accepted, observed({ observation_revision: 11, direct: command(accepted, status, error) }, 400)).direct
  expect(at('accepted')!.status).toBe('accepted')
  expect(at('executing')!.status).toBe('accepted')
  expect(at('completed')).toMatchObject({ status: 'done', error: null })
  expect(at('uncertain')!.status).toBe('uncertain')
  expect(at('failed', 'Error: listing_changed_or_ineligible')).toMatchObject({
    status: 'refused',
    error: 'listing_changed_or_ineligible',
  })
  expect(at('failed', 'bot_busy_or_paused')).toMatchObject({ status: 'refused', error: 'bot_busy_or_paused' })
  // A raw chain or SDK failure never reaches the player as text.
  expect(at('failed', 'Error: MoveAbort(0x2::kiosk, 5) in command 3')).toMatchObject({
    status: 'refused',
    error: 'direct_failed',
  })
  const refused = fold(connected, buy(), {
    type: 'dapp/direct_sent',
    id: 'o1',
    outcome: { kind: 'refused', error: 'bot_busy_or_paused' },
    now: 300,
  })
  expect(refused.direct).toMatchObject({ status: 'refused', error: 'bot_busy_or_paused' })
  expect(refused.settled_ms).toBe(connected.settled_ms)
})

test('an unknown answer is never sent again: it resolves from the next observation of the bot', () => {
  const unknown = fold(connected, buy(), sent('o1', 'uncertain', 300))
  expect(unknown.direct!.status).toBe('uncertain')
  expect(fold(unknown, buy('o2'))).toBe(unknown)
  const next = (overrides: Readonly<Record<string, unknown>>, account = ACCOUNT) =>
    fold_under(account)(unknown, observed({ observation_revision: 11, ...overrides }, 400)).direct
  // The request reached the bot: its command is followed.
  expect(next({ direct: command(unknown, 'accepted') })!.status).toBe('accepted')
  // It did not, or the bot lost it: nothing proves the purchase. A key in the bag may be a hero's own find.
  expect(next({}, bag(1))).toMatchObject({ status: 'refused', error: 'direct_unconfirmed' })
  expect(next({})).toMatchObject({ status: 'refused', error: 'direct_unconfirmed' })
  // An unread bag proves nothing either way, and an older command of the bot is not this order's.
  expect(next({}, bag(0, { phase: 'loading' }))!.status).toBe('uncertain')
  const earlier = { ...command(unknown, 'failed', 'needs_resync'), id: 'earlier' }
  const repeat = fold(
    connected,
    observed({ observation_revision: 11, direct: earlier }, 200),
    buy(),
    sent('o1', 'uncertain', 300),
    observed({ observation_revision: 12, direct: earlier }, 400)
  )
  expect(repeat.direct).toMatchObject({ status: 'refused', error: 'direct_unconfirmed' })
  // Units that reach the bag later prove nothing: a hero may have found them. The notice stays as it is.
  expect(fold_under(bag(1))(repeat, { type: 'dapp/tab', tab: 'market' }).direct).toBe(repeat.direct)
})

test('a bought key puts one more hero in the raid as soon as the socket pushes the bag', () => {
  const [one, two] = [bag(1), bag(2)]
  expect(activity_offer(connected, one, RAID, 'Title').plan).toMatchObject({
    starts: [{ hero_id: SECOND }],
    missing_keys: { [KEY]: 1 },
  })
  const ordering = fold_under(one)(connected, buy(), sent('o1', 'done', 300))
  const bought = fold_under(two)(
    ordering,
    observed({ observation_revision: 12, direct: command(ordering, 'completed') }, 400)
  )
  expect(bought.direct!.status).toBe('done')
  const { plan } = activity_offer(bought, two, RAID, 'Title')
  expect(plan.starts.map(({ hero_id: hero }) => hero)).toEqual([SECOND, HERO])
  expect(plan.missing_keys).toEqual({})
  // The purchase waited for nobody: a hero already out does not block the market.
  const raiding = fold_under(one)(connected, observed({ observation_revision: 12, runs: [run_fixture(SECOND)] }, 300))
  expect(fold_under(one)(raiding, buy()).direct).toMatchObject({
    status: 'pending',
    payload: { character_id: SECOND },
  })
})

test('a listing sells the exact object the player selected, never another of its type', () => {
  const ore = (id: string, amount: number) => ({ ...item_fixture('copper_ore', amount, id), version: '7' })
  const under = fold_under(
    account_fixture({ characters: team, items: [ore('small', 4), ore('large', 40), ore('exact', 12)] })
  )
  const sell = (amount: number, id = 'large'): DappInput => ({
    type: 'dapp/sell',
    id: 's1',
    listing: { id, item_type: 'copper_ore', amount, price_mist: '2000' },
  })
  // Two objects of one type can carry different rolls: a smaller stack that would also fit is not chosen.
  expect(under(connected, sell(10)).direct).toMatchObject({
    action: 'market_sell',
    status: 'pending',
    payload: {
      character_id: SECOND,
      source_kiosk: '0xkiosk',
      item_id: 'large',
      item_version: '7',
      item_type: 'copper_ore',
      source_amount: 40,
      amount: 10,
      price_mist: '2000',
    },
  })
  // The selected stack does not hold the lot, or left the bag: nothing is sent, and no other stack stands in.
  for (const order of [sell(100), sell(10, 'small'), sell(1, 'gone')])
    expect(under(connected, order).direct).toMatchObject({
      status: 'refused',
      error: 'sale_source_changed_or_unavailable',
    })
  // A listing is proven only by the bot's own command, never guessed from the bag.
  const listed = under(connected, sell(10), sent('s1', 'done', 300), observed({ observation_revision: 12 }, 400))
  expect(listed.direct).toMatchObject({ status: 'refused', error: 'direct_unconfirmed' })
})

test('a listing is withdrawn by its own item and kiosk; sale proceeds are never a request of this page', () => {
  const own = listing_fixture('copper_ore', '5', { id: `0x${'a'.repeat(64)}`, seller: AGENT, amount: 12 })
  const hero_sale = { ...own, id: `0x${'b'.repeat(64)}`, kind: 'character', item_type: null }
  const selling = bag(0, { listings: [own, hero_sale] })
  const under = fold_under(selling)
  const delist = (listing: Readonly<{ id: string; kiosk: string }>, id = 'd1'): DappInput => ({
    type: 'dapp/delist',
    id,
    listing,
  })
  const withdrawing = under(connected, delist(own))
  // The bot's own payload: the listing's item and kiosk, both as the account lists them.
  expect(withdrawing.direct).toMatchObject({
    action: 'market_delist',
    status: 'pending',
    hero_id: null,
    payload: { item_id: own.id, kiosk: own.kiosk },
    item_type: 'copper_ore',
    amount: 12,
    proof: null,
  })
  // It shares the wallet's one slot: no purchase and no second withdrawal meanwhile.
  expect(under(withdrawing, buy('o1'))).toBe(withdrawing)
  expect(under(withdrawing, delist(own, 'd2'))).toBe(withdrawing)
  // A listing that sold or was withdrawn already, or one of another kiosk, is gone: nothing is sent.
  for (const listing of [
    { ...own, id: 'gone' },
    { ...own, kiosk: '0xelsewhere' },
  ])
    expect(under(connected, delist(listing)).direct).toMatchObject({ status: 'refused', error: 'listing_gone' })
  // The bot withdraws items only: a hero for sale is refused with the bot's own code.
  expect(under(connected, delist(hero_sale)).direct).toMatchObject({
    status: 'refused',
    error: 'listing_changed_or_ineligible',
  })
  // The bot's word ends it; its refusal reaches the player as its code.
  const accepted = under(withdrawing, sent('d1', 'done', 300))
  const at = (status: string, error?: string) =>
    under(accepted, observed({ observation_revision: 12, direct: command(accepted, status, error) }, 400)).direct
  expect(at('completed')).toMatchObject({ status: 'done', error: null })
  expect(at('failed', 'Error: listing_gone')).toMatchObject({ status: 'refused', error: 'listing_gone' })
  // The marketplace's own Withdraw control becomes the page's request; browsing stays public.
  const row = own as unknown as ListingRow
  expect(market_input({ type: 'market/delist_requested', listing: row }, 'd1')).toEqual(delist(row))
  expect(market_input({ type: 'market/buy_requested', listing: row }, 'b1')).toEqual({
    type: 'dapp/buy',
    id: 'b1',
    listing: row,
  })
  const browse = { type: 'market/opened' } as const
  expect(market_input(browse, 'x')).toBe(browse)
  // The page cannot know what waits in the kiosks, so it has no request for proceeds: the bot collects
  // them by itself. Its collection is the bot's own command, never the answer to a request of this page.
  const collect = { type: 'market/collect_requested' } as const
  expect(market_input(collect, 'k1')).toBe(collect)
  const own_collect = { id: 'auto', kind: 'market_collect', status: 'completed', payload: { kiosks: ['0xk'] } }
  expect(under(accepted, observed({ observation_revision: 12, direct: own_collect }, 400)).direct).toMatchObject({
    action: 'market_delist',
    status: 'refused',
    error: 'direct_unconfirmed',
  })
})
