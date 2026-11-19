// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { ListingRow } from '@aresrpg/protocol'

import { bot_market } from '../../src/dapp/market.ts'
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
  type: 'dapp/order_sent',
  id,
  outcome: { kind },
  now,
})
/** The bot's own command for an order, as its observation lists it. */
const command = (state: DappState, status: string, error?: string) => ({
  id: 'bot-command',
  kind: state.order!.action,
  status,
  error,
  payload: state.order!.payload,
})

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
  const source = bot_market({ account, address: AGENT }, state.order, live)
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
  expect(source.capabilities).toEqual({ characters: false, withdraw: false, history: false })
})

test('a purchase is one order with the shown total as its ceiling; a second tap changes nothing', () => {
  const ordering = fold(connected, buy())
  expect(ordering.order).toMatchObject({ id: 'o1', action: 'market_buy', status: 'pending', item_type: KEY, amount: 1 })
  expect(ordering.order!.payload).toEqual({
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
    bot_market({ account: ACCOUNT, address: AGENT }, ordering.order, initial_marketplace_state()).market.pending
  ).toBe('o1')
  // The order is unresolved money: the page neither disconnects nor sends a stat change meanwhile.
  expect(commands_unresolved(ordering)).toBe(true)
  expect(fold(ordering, { type: 'dapp/disconnect' })).toBe(ordering)
  const edit: DappInput = { type: 'dapp/hero_action', id: 'h', hero_id: HERO, action: 'raise_spell', payload: {} }
  expect(fold(ordering, edit)).toBe(ordering)
  expect(fold(ordering, { type: 'dapp/order_dismissed' })).toBe(ordering)
})

test('an order the bot would refuse is refused before it is sent, with the reason', () => {
  const refused = (account: DappAccount, listing = offer) => fold_under(account)(connected, buy('o1', listing)).order
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
  expect(again.order).toMatchObject({ id: 'o2', status: 'pending' })
  expect(fold_under(poor)(connected, buy(), { type: 'dapp/order_dismissed' }).order).toBeNull()
})

test('the bot answers an order once; its observations then say bought, refused or still unknown', () => {
  const accepted = fold(connected, buy(), sent('o1', 'done', 300))
  expect(accepted.order!.status).toBe('accepted')
  // An observation requested before the answer proves nothing about it.
  expect(fold(accepted, observed({ observation_revision: 11 }, 250)).order).toBe(accepted.order)
  const at = (status: string, error?: string) =>
    fold(accepted, observed({ observation_revision: 11, direct: command(accepted, status, error) }, 400)).order
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
    error: 'order_failed',
  })
  const refused = fold(connected, buy(), {
    type: 'dapp/order_sent',
    id: 'o1',
    outcome: { kind: 'refused', error: 'bot_busy_or_paused' },
    now: 300,
  })
  expect(refused.order).toMatchObject({ status: 'refused', error: 'bot_busy_or_paused' })
  expect(refused.settled_ms).toBe(connected.settled_ms)
})

test('an unknown answer is never sent again: it resolves from the next observation of the bot', () => {
  const unknown = fold(connected, buy(), sent('o1', 'uncertain', 300))
  expect(unknown.order!.status).toBe('uncertain')
  expect(fold(unknown, buy('o2'))).toBe(unknown)
  const next = (overrides: Readonly<Record<string, unknown>>, account = ACCOUNT) =>
    fold_under(account)(unknown, observed({ observation_revision: 11, ...overrides }, 400)).order
  // The request reached the bot: its command is followed.
  expect(next({ direct: command(unknown, 'accepted') })!.status).toBe('accepted')
  // It did not, or the bot lost it: only the bag can prove a purchase.
  expect(next({}, bag(1))).toMatchObject({ status: 'done' })
  expect(next({})).toMatchObject({ status: 'refused', error: 'order_unconfirmed' })
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
  expect(repeat.order).toMatchObject({ status: 'refused', error: 'order_unconfirmed' })
})

test('a bought key puts one more hero in the raid as soon as the socket pushes the bag', () => {
  const [one, two] = [bag(1), bag(2)]
  expect(activity_offer(connected, one, 'raid', [HERO, SECOND], 'Title').plan).toMatchObject({
    starts: [{ hero_id: SECOND }],
    missing_keys: { [KEY]: 1 },
  })
  const ordering = fold_under(one)(connected, buy(), sent('o1', 'done', 300))
  const bought = fold_under(two)(
    ordering,
    observed({ observation_revision: 12, direct: command(ordering, 'completed') }, 400)
  )
  expect(bought.order!.status).toBe('done')
  const { plan } = activity_offer(bought, two, 'raid', [HERO, SECOND], 'Title')
  expect(plan.starts.map(({ hero_id: hero }) => hero)).toEqual([SECOND, HERO])
  expect(plan.missing_keys).toEqual({})
  // The purchase waited for nobody: a hero already out does not block the market.
  const raiding = fold_under(one)(connected, observed({ observation_revision: 12, runs: [run_fixture(SECOND)] }, 300))
  expect(fold_under(one)(raiding, buy()).order).toMatchObject({
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
  expect(under(connected, sell(10)).order).toMatchObject({
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
    expect(under(connected, order).order).toMatchObject({
      status: 'refused',
      error: 'sale_source_changed_or_unavailable',
    })
  // A listing is proven only by the bot's own command, never guessed from the bag.
  const listed = under(connected, sell(10), sent('s1', 'done', 300), observed({ observation_revision: 12 }, 400))
  expect(listed.order).toMatchObject({ status: 'refused', error: 'order_unconfirmed' })
})
