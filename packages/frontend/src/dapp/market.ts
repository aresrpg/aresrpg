// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { CharacterRow, ItemRow, ListingRow } from '@aresrpg/protocol'

import type { MarketSource } from '../marketplace/MarketSource.tsx'
import { buyer_total, market_needs_funding } from '../marketplace/price.ts'
import type { MarketplaceState } from '../modules/marketplace.ts'

import { held_items, strongest_first, type DappAccount } from './account.ts'
import { direct_open, direct_request, type DirectPayload, type DirectRequest, type DirectSeen } from './direct.ts'

/** The hero whose kiosk receives or hands over the lot. The bot moves items only for a hero standing free. */
const carrier = (heroes: readonly CharacterRow[], kiosk?: string): CharacterRow | null =>
  strongest_first(heroes).find((hero) =>
    [hero.custody === 'kiosk', !hero.active_fight, !hero.ambush, !kiosk || hero.kiosk === kiosk].every(Boolean)
  ) ?? null

const buy_refusal = (
  { account }: DirectSeen,
  listing: Readonly<ListingRow>,
  hero: Readonly<CharacterRow> | null
): string | null => {
  if (!listing.item_type) return 'listing_changed_or_ineligible'
  if (market_needs_funding(listing.price_mist, account.sui_balance_mist)) return 'insufficient_funds'
  return hero ? null : 'character_not_available'
}

/** A purchase names the exact offer on screen and never pays more than the total shown for it. The
 * bot reads that item's current offers itself before it signs, and refuses an offer that changed.
 * Only the bot's own command proves it: units that reach the bag may be a hero's own find. */
export const buy_request = (id: string, seen: DirectSeen, listing: Readonly<ListingRow>): DirectRequest => {
  const { observation, account } = seen
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
  const { amount } = listing
  const draft = { action: 'market_buy' as const, item_type, amount, payload }
  return direct_request(id, observation, draft, buy_refusal(seen, listing, hero))
}

/**
 * The bot lists the exact object the player selected, never another of its type: two items of one
 * type can carry different rolls. A lot no single stack holds is refused, because the bot merges nothing.
 */
const sale_source = (rows: readonly ItemRow[], listing: Readonly<Pick<ListingRow, 'id' | 'amount'>>) =>
  rows.find((row) => row.id === listing.id && row.amount >= listing.amount)

export const sell_request = (
  id: string,
  { observation, account }: DirectSeen,
  listing: Readonly<Pick<ListingRow, 'id' | 'item_type' | 'amount' | 'price_mist'>>
): DirectRequest => {
  const item_type = listing.item_type ?? ''
  const request = (payload: DirectPayload, refusal: string | null) =>
    direct_request(id, observation, { action: 'market_sell', item_type, amount: listing.amount, payload }, refusal)
  const source = sale_source(account.inventory, listing)
  if (!source?.version) return request({}, 'sale_source_changed_or_unavailable')
  const hero = carrier(account.characters, source.kiosk)
  if (!hero) return request({}, 'character_not_available')
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
  return request(payload, null)
}

/** The bot withdraws an item listing only; one the account no longer shows sold or was withdrawn already. */
const delist_refusal = (own: Readonly<ListingRow> | undefined): string | null => {
  if (!own) return 'listing_gone'
  return own.kind === 'item' ? null : 'listing_changed_or_ineligible'
}
/** A listing is withdrawn by its own item and kiosk. One the bot would refuse is refused here, with
 * the bot's own code, and nothing is sent. */
export const delist_request = (
  id: string,
  { observation, account }: DirectSeen,
  listing: Readonly<Pick<ListingRow, 'id' | 'kiosk'>>
): DirectRequest => {
  const own = account.catalogue.own_listings.find((row) => row.id === listing.id && row.kiosk === listing.kiosk)
  const draft = {
    action: 'market_delist' as const,
    item_type: own?.item_type ?? null,
    amount: own?.amount ?? 0,
    payload: { item_id: listing.id, kiosk: listing.kiosk },
  }
  return direct_request(id, observation, draft, delist_refusal(own))
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
  direct: DirectRequest | null,
  live: MarketplaceState
): Source => ({
  ...bot_account(account, address),
  market: {
    ...live,
    ...NOTHING,
    own_listings: account.catalogue.own_listings,
    // The wallet holds one direct command: while any request is open, the market sends no other.
    pending: direct_open(direct) ? direct.id : null,
  },
  // The bot withdraws an item listing; character trades and the sales ledger have no source for its account.
  capabilities: { characters: false, withdraw: true, history: false },
})
