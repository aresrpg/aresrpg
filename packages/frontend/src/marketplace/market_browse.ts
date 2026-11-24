// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// What the market page reads from the listed types and offers: which group shows what, the rarest item, the price
// of one unit, the cheapest offers, and what the page observes.
import { item_is_stackable, is_item_category, is_weapon_category, type ItemCategory } from '@aresrpg/immutable'
import type { ListingRow, MarketQuote, MarketType, MarketUnitPrice } from '@aresrpg/protocol'

import { market_categories, MARKET_GROUPS, type MarketGroup, type MarketSubject } from '../modules/marketplace.ts'

import { buyer_total } from './price.ts'

/** Unique copies are cards; stackable items trade like tokens, one row each. */
export const is_unique = (row: Readonly<Pick<MarketType, 'category'>>): boolean => !item_is_stackable(row.category)

const listed_units = (row: Readonly<MarketType>): number => row.quote.units
/** Most listed first, then by name: the one order of every shelf, grid and table of the page. */
const by_listed_units = (left: Readonly<MarketType>, right: Readonly<MarketType>): number =>
  listed_units(right) - listed_units(left) || left.name.localeCompare(right.name)

/** The groups of item types, in the market's order. Heroes are listings, not item types. */
export const ITEM_GROUPS = Object.freeze(MARKET_GROUPS.filter((group) => market_categories(group).length > 0))

/** The ground a card stands on, from the rarest kind down: a relic, then a pet or a title, then a weapon, then
 *  everything else a hero wears. A tool, a key and a rune keep the plain ground. */
export type CardTone = 'relic' | 'pet' | 'title' | 'weapon' | 'gear'
const PLAIN: ReadonlySet<string> = new Set(['key', 'rune', 'tool_farmer', 'tool_herbalist', 'tool_miner'])
export const card_tone = (category: string): CardTone | null => {
  if (category === 'relic' || category === 'pet' || category === 'title') return category
  if (is_weapon_category(category)) return 'weapon'
  return PLAIN.has(category) || item_is_stackable(category) ? null : 'gear'
}

/** A group of unique items shows cards; a group of stackable items a token table. The categories decide it. */
export const holds_cards = (group: MarketGroup): boolean =>
  market_categories(group).some((category) => !item_is_stackable(category))

/** A group's listed types, or one of its categories when a chip narrows it. */
export const group_types = (
  types: readonly MarketType[],
  group: MarketGroup,
  category: ItemCategory | null = null
): readonly MarketType[] =>
  types
    .filter((row) => (category ? row.category === category : market_categories(group).includes(row.category)))
    .toSorted(by_listed_units)

/** How many listed types fall in some categories: the count beside each group of the market page. */
export const listed_type_count = (types: readonly MarketType[], categories: readonly ItemCategory[]): number =>
  types.filter((row) => categories.includes(row.category)).length

/** The categories of a group that hold a listed type, in the group's own order. */
export const group_chips = (types: readonly MarketType[], group: MarketGroup): readonly ItemCategory[] =>
  market_categories(group).filter((category) => types.some((row) => row.category === category))

export const search_types = (types: readonly MarketType[], query: string): readonly MarketType[] => {
  const words = query.trim().toLocaleLowerCase()
  return types.filter((row) => row.name.toLocaleLowerCase().includes(words)).toSorted(by_listed_units)
}

/** What the browse view shows: Featured without a group, a group narrowed by an optional chip, or a search. */
export type MarketView = Readonly<{ group: MarketGroup | null; category: ItemCategory | null; query: string }>
export const FEATURED: MarketView = Object.freeze({ group: null, category: null, query: '' })

/** Heroes are listings the market observes on their own; a search always reads the item types. */
export const shows_heroes = (view: MarketView): boolean => view.group === 'CHARACTERS' && !view.query

export const view_types = (types: readonly MarketType[], view: MarketView): readonly MarketType[] => {
  if (view.query) return search_types(types, view.query)
  return view.group ? group_types(types, view.group, view.category) : []
}

const cheaper = (left: MarketUnitPrice, right: MarketUnitPrice): boolean =>
  BigInt(left.mist) * BigInt(right.units) < BigInt(right.mist) * BigInt(left.units)

/** The cheapest public price of one unit, as the lot that offers it: the lowest total over units among the
 *  type's per-lot floors; null when no paid standard lot is listed. */
export const unit_floor = (quote: MarketQuote): MarketUnitPrice | null =>
  Object.entries(quote.lots).reduce<MarketUnitPrice | null>((floor, [units, mist]) => {
    const lot = { mist, units }
    return floor === null || cheaper(lot, floor) ? lot : floor
  }, null)

/** The rarest item on the market: the unique type with the fewest listed copies and a price. The page cannot
 *  rank by copies in existence: that count arrives for one type at a time, with its price history. */
export const rarest_type = (types: readonly MarketType[]): MarketType | null =>
  types
    .filter((row) => is_unique(row) && unit_floor(row.quote) !== null)
    .toSorted(
      (left, right) =>
        listed_units(left) - listed_units(right) || right.level - left.level || left.name.localeCompare(right.name)
    )[0] ?? null

/** What one unit costs a buyer, in SUI: the cheapest lot's buyer total over its units. */
export const unit_price_sui = (quote: MarketQuote | undefined): number | null => {
  const floor = quote ? unit_floor(quote) : null
  return floor ? Number(buyer_total(BigInt(floor.mist))) / Number(floor.units) / 1_000_000_000 : null
}

type PriceChange = Readonly<{ text: string; direction: 'up' | 'down' | 'flat' }>
/** The last full day's average unit price against the day before, signed; null when it did not sell on both. */
export const price_change = (change_bps: number | null | undefined, locale: string): PriceChange | null =>
  change_bps === null || change_bps === undefined
    ? null
    : {
        text: (change_bps / 10_000).toLocaleString(locale, {
          style: 'percent',
          signDisplay: 'exceptZero',
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        }),
        direction: change_bps > 0 ? 'up' : change_bps < 0 ? 'down' : 'flat',
      }

/** What the page observes: the offers of the item it shows, the listed heroes, or the listed types alone. An
 *  address naming no known item observes the listed types. */
export const market_subject = (
  item: Readonly<{ item_type: string; category: string }> | undefined,
  heroes: boolean
): MarketSubject => {
  if (item && is_item_category(item.category))
    return { kind: 'offers', category: item.category, item_type: item.item_type }
  return heroes ? { kind: 'characters' } : { kind: 'types' }
}

/** One cheapest offer per server group: the server's grouping decides, the next offers wait for the next buy. */
export const cheapest_offers = (listings: readonly ListingRow[]): readonly ListingRow[] => {
  const sorted = listings.toSorted((left, right) => {
    const difference = BigInt(left.price_mist) - BigInt(right.price_mist)
    return difference < 0n ? -1 : difference > 0n ? 1 : left.id.localeCompare(right.id)
  })
  const groups = new Set<string>()
  return sorted.filter((listing) => {
    const key = JSON.stringify([listing.item_type, listing.group_key ?? `object:${listing.id}`])
    if (groups.has(key)) return false
    groups.add(key)
    return true
  })
}
