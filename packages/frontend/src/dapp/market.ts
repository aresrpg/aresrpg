// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { CharacterRow, ItemRow, ListingRow } from '@aresrpg/protocol'

import type { MarketSource } from '../marketplace/MarketSource.tsx'
import { buyer_total, market_needs_funding } from '../marketplace/price.ts'
import type { MarketplaceState } from '../modules/marketplace.ts'

import { held_items, strongest_first, type DappAccount } from './account.ts'
import type { DappDirect, DappObservation } from './observation.ts'

/**
 * One request to trade as the bot account. It is sent once, then followed in the bot's observations:
 * `accepted` waits in the bot's signing queue, `uncertain` waits for an observation and is never sent again.
 */
export type MarketOrder = Readonly<{
  id: string
  action: 'market_buy' | 'market_sell'
  /** The bot's typed action. A purchase carries the total the player saw as its ceiling. */
  payload: Readonly<Record<string, unknown>>
  item_type: string
  amount: number
  /** Units of this item in the bag when the order was placed: a purchase adds to it. */
  held: number
  /** The direct command the bot held before this order, which is never this order's own. */
  after: string | null
  status: 'pending' | 'accepted' | 'uncertain' | 'done' | 'refused'
  error: string | null
}>
export const order_open = (order: MarketOrder | null): order is MarketOrder =>
  order !== null && ['pending', 'accepted', 'uncertain'].includes(order.status)

/** The hero whose kiosk receives or hands over the lot. The bot moves items only for a hero standing free. */
const carrier = (heroes: readonly CharacterRow[], kiosk?: string): CharacterRow | null =>
  strongest_first(heroes).find((hero) =>
    [hero.custody === 'kiosk', !hero.active_fight, !hero.ambush, !kiosk || hero.kiosk === kiosk].every(Boolean)
  ) ?? null

type Draft = Pick<MarketOrder, 'action' | 'item_type' | 'amount' | 'payload'>
/** An order the bot would refuse anyway is refused here, with the bot's own code, and nothing is sent. */
type Seen = Readonly<{ observation: DappObservation; account: DappAccount }>
const order_of = (id: string, { observation, account }: Seen, draft: Draft, refusal: string | null): MarketOrder => ({
  id,
  ...draft,
  held: held_items(account.inventory)[draft.item_type] ?? 0,
  after: observation.direct?.id ?? null,
  status: refusal ? 'refused' : 'pending',
  error: refusal,
})
const buy_refusal = (
  { account }: Seen,
  listing: Readonly<ListingRow>,
  hero: Readonly<CharacterRow> | null
): string | null => {
  if (!listing.item_type) return 'listing_changed_or_ineligible'
  if (market_needs_funding(listing.price_mist, account.sui_balance_mist)) return 'insufficient_funds'
  return hero ? null : 'character_not_available'
}

/** A purchase names the exact offer on screen and never pays more than the total shown for it. The
 * bot reads that item's current offers itself before it signs, and refuses an offer that changed. */
export const buy_order = (
  observation: DappObservation,
  account: DappAccount,
  id: string,
  listing: Readonly<ListingRow>
): MarketOrder => {
  const seen = { observation, account }
  const hero = carrier(account.characters)
  const item_type = listing.item_type ?? ''
  const payload = {
    character_id: hero?.id,
    item_id: listing.id,
    seller_kiosk: listing.kiosk,
    listing_version: listing.version,
    item_type,
    amount: listing.amount,
    price_mist: listing.price_mist,
    max_total_mist: String(buyer_total(BigInt(listing.price_mist))),
  }
  const draft: Draft = { action: 'market_buy', item_type, amount: listing.amount, payload }
  return order_of(id, seen, draft, buy_refusal(seen, listing, hero))
}

/**
 * The bot lists the exact object the player selected, never another of its type: two items of one
 * type can carry different rolls. A lot no single stack holds is refused, because the bot merges nothing.
 */
const sale_source = (rows: readonly ItemRow[], listing: Readonly<Pick<ListingRow, 'id' | 'amount'>>) =>
  rows.find((row) => row.id === listing.id && row.amount >= listing.amount)

export const sell_order = (
  observation: DappObservation,
  account: DappAccount,
  id: string,
  listing: Readonly<Pick<ListingRow, 'id' | 'item_type' | 'amount' | 'price_mist'>>
): MarketOrder => {
  const item_type = listing.item_type ?? ''
  const draft = (payload: MarketOrder['payload']): Draft => ({
    action: 'market_sell',
    item_type,
    amount: listing.amount,
    payload,
  })
  const seen = { observation, account }
  const source = sale_source(account.inventory, listing)
  if (!source?.version) return order_of(id, seen, draft({}), 'sale_source_changed_or_unavailable')
  const hero = carrier(account.characters, source.kiosk)
  if (!hero) return order_of(id, seen, draft({}), 'character_not_available')
  const payload = {
    character_id: hero.id,
    source_kiosk: source.kiosk,
    item_id: source.id,
    item_version: source.version,
    item_type,
    source_amount: source.amount,
    amount: listing.amount,
    price_mist: listing.price_mist,
  }
  return order_of(id, seen, draft(payload), null)
}

/** A bot failure reads `Error: code`; anything that is not a plain code is an order that did not go through. */
const refusal_code = (error: string | null): string => {
  const code = (error ?? '').replace(/^Error: /, '')
  return /^[a-z_]+$/.test(code) ? code : 'order_failed'
}
const same_payload = (left: MarketOrder['payload'], right: MarketOrder['payload']): boolean =>
  Object.keys(left).length === Object.keys(right).length &&
  Object.entries(left).every(([key, value]) => JSON.stringify(value) === JSON.stringify(right[key]))
const own_command = (order: MarketOrder, direct: DappDirect | null): DappDirect | null =>
  direct !== null &&
  [direct.id !== order.after, direct.kind === order.action, same_payload(direct.payload, order.payload)].every(Boolean)
    ? direct
    : null
/** Without a command at the bot only the bag can prove a purchase; anything else stays unconfirmed. */
const bag_outcome = (order: MarketOrder, items: Readonly<Record<string, number>>): MarketOrder => {
  const bought = order.action === 'market_buy' && (items[order.item_type] ?? 0) >= order.held + order.amount
  return bought
    ? { ...order, status: 'done', error: null }
    : { ...order, status: 'refused', error: 'order_unconfirmed' }
}
const OUTCOMES: Readonly<Record<string, MarketOrder['status']>> = {
  accepted: 'accepted',
  executing: 'accepted',
  completed: 'done',
  uncertain: 'uncertain',
}
/** A fresh observation is the truth of a sent order: the bot's own command for it, else the bag once it is read. */
export const followed_order = (
  order: MarketOrder | null,
  observation: DappObservation,
  account: DappAccount
): MarketOrder | null => {
  if (!order || !['accepted', 'uncertain'].includes(order.status)) return order
  const command = own_command(order, observation.direct)
  if (!command) return account.phase === 'ready' ? bag_outcome(order, held_items(account.inventory)) : order
  const status = OUTCOMES[command.status] ?? 'refused'
  return { ...order, status, error: status === 'refused' ? refusal_code(command.error) : null }
}

const NOTHING = Object.freeze({ history: [], profits: [], revenue_30d_mist: '0', history_total: 0 })
type Source = Pick<MarketSource, 'market' | 'account' | 'trades' | 'capabilities'>
/** The bot's bag and balance, and what locks its items, as the game server pushes them. */
const bot_account = (account: DappAccount, address: string | null): Pick<Source, 'account' | 'trades'> => ({
  account: {
    inventory: account.inventory,
    characters: [],
    wallet: address ? { address } : null,
    sui_balance_mist: account.sui_balance_mist,
  },
  trades: account.trades,
})
/**
 * The market as the bot account trades it. Offers, navigation, counts and price history are the
 * public market data of this page's own game socket; the bag, balance and listings are the bot account's.
 */
export const bot_market = (
  { account, address }: Readonly<{ account: DappAccount; address: string | null }>,
  order: MarketOrder | null,
  live: MarketplaceState
): Source => ({
  ...bot_account(account, address),
  market: {
    ...live,
    ...NOTHING,
    own_listings: account.catalogue.own_listings,
    pending: order_open(order) ? order.id : null,
  },
  capabilities: { characters: false, withdraw: false, history: false },
})
