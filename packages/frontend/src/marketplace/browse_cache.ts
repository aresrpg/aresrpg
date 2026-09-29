// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { has_market_page, type ListingRow, type MarketObservation, type MarketQuery } from '@aresrpg/protocol'

export type RecentOfferPage = Readonly<{ key: string; listings: readonly ListingRow[] }>
type BrowseState = Readonly<{
  observation: MarketObservation | null
  ready_request: number | null
  listings: readonly ListingRow[]
  recent_pages: readonly RecentOfferPage[]
}>

export const market_query_key = (query: MarketQuery): string => {
  switch (query.kind) {
    case 'overview':
      return 'overview'
    case 'types':
      return JSON.stringify(['types', query.category])
    case 'offers':
      return JSON.stringify(['offers', query.category, query.item_type, query.cursor ?? ''])
    case 'characters':
      return JSON.stringify(['characters', query.classe, query.min_level, query.max_level, query.cursor ?? ''])
  }
}

export const remember_offer_page = (
  pages: readonly RecentOfferPage[],
  query: MarketObservation,
  listings: readonly ListingRow[]
): readonly RecentOfferPage[] => {
  const key = market_query_key(query)
  return [{ key, listings }, ...pages.filter((page) => page.key !== key)].slice(0, 10)
}

export const market_page_ready = (market: Pick<BrowseState, 'observation' | 'ready_request'>): boolean =>
  market.observation !== null && market.ready_request === market.observation.request

/** Historical rows are presentation only; they never populate the live purchase catalogue. */
export const displayed_listings = (market: BrowseState): readonly ListingRow[] => {
  if (market_page_ready(market)) return market.listings
  if (!has_market_page(market.observation)) return []
  const key = market_query_key(market.observation)
  return market.recent_pages.find((page) => page.key === key)?.listings ?? []
}

export const current_offer = (market: BrowseState, listing: Readonly<ListingRow>): boolean =>
  market_page_ready(market) &&
  market.listings.some(
    (row) =>
      row.id === listing.id &&
      row.kiosk === listing.kiosk &&
      row.version === listing.version &&
      row.price_mist === listing.price_mist &&
      row.amount === listing.amount
  )
