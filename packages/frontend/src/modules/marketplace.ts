// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One marketplace reducer: server projections in, user intents out, SDK receipts re-enter.

import {
  fold_catalogue,
  catalogue_departed,
  latest_listings,
  without_relation,
  type CatalogueProjection,
} from '@aresrpg/protocol/inventory'
import { equipment_categories, is_cosmetic_category, type ItemCategory } from '@aresrpg/immutable'
import {
  MAX_TRACKED_CHARACTERS,
  type ListingRow,
  type MarketType,
  type MarketQuery,
  has_market_page,
  type MarketVolume,
  type MarketObservation,
  type MarketSaleRow,
  type ClientPacket,
  type ServerPacket,
} from '@aresrpg/protocol'

import { buyer_total, market_needs_funding } from '../marketplace/price.ts'
import {
  current_offer,
  market_query_key,
  remember_offer_page,
  type RecentOfferPage,
} from '../marketplace/browse_cache.ts'
import { localized_error } from '../i18n/error_text.ts'
import {
  initial_price_history,
  market_price_subscription,
  reduce_market_prices,
  type PriceHistoryState,
  type PriceHistoryInput,
} from '../marketplace/price_history_state.ts'
import type { AppInput, SiteModule, SiteState } from '../store.ts'
import { toast, type ToastPart } from '../toast.ts'
import { copy_text } from '../i18n/copy.ts'
import { encumbered_asset_ids, stack_merge_target_row } from '../inventory_stacks.ts'
import { items_by_type } from '../content/items.ts'
import { titleize } from '../content/titles.ts'
import { format_sui } from '../wallet_amount.ts'
import { link_accepted } from '../server_link.ts'

import { observe_subscriptions } from './session.ts'

export const MARKET_GROUPS = [
  'EQUIPMENT',
  'COSMETICS',
  'TITLES',
  'PETS',
  'RUNES',
  'CONSUMABLE',
  'KEYS',
  'RESOURCES',
  'CHARACTERS',
] as const
export type MarketGroup = (typeof MARKET_GROUPS)[number]

const cosmetic_categories = Object.freeze(equipment_categories.filter(is_cosmetic_category))
/** What a hero wears to fight. Cosmetics, titles and pets are groups of their own. */
const SET_APART: ReadonlySet<string> = new Set(['pet', 'title', ...cosmetic_categories])
const equipment = Object.freeze(equipment_categories.filter((category) => !SET_APART.has(category)))

const MARKET_CATEGORIES: Readonly<Record<MarketGroup, readonly ItemCategory[]>> = Object.freeze({
  EQUIPMENT: equipment,
  COSMETICS: cosmetic_categories,
  TITLES: ['title'],
  PETS: ['pet'],
  RUNES: ['rune'],
  CONSUMABLE: ['consumable'],
  KEYS: ['key'],
  RESOURCES: ['resource'],
  CHARACTERS: [],
})
export const market_categories = (group: MarketGroup): readonly ItemCategory[] => MARKET_CATEGORIES[group]

export type MarketplaceState = CatalogueProjection &
  Readonly<{
    prices: PriceHistoryState
    /** Every publicly listed type with its quote; null until the first list arrives. Public data: it stays
     *  on screen across pages, reconnections and sign-ins, and each new list replaces it. */
    types: readonly MarketType[] | null
    next_cursor: string | null
    page_cursors: readonly string[]
    /** What the market view on screen observes; null while none is. */
    observation: MarketObservation | null
    /** How many observations this store has made: each one, a page turn and a new viewer included, takes the next
     *  number as its request, so a reply to an earlier one is never taken for the current page. */
    requests: number
    ready_request: number | null
    recent_pages: readonly RecentOfferPage[]
    history: readonly MarketSaleRow[]
    revenue_30d_mist: string
    volume: MarketVolume | null
    history_total: number
    profits: readonly Readonly<{ kiosk: string; amount_mist: string }>[]
    pending: string | null
  }>

/** What one market view observes: the listed types alone, an item's offers or the listed heroes. */
export type MarketSubject = MarketQuery | Readonly<{ kind: 'types' }>

export type MarketplaceInput =
  | PriceHistoryInput
  /** The market view on screen and what it shows; null when no market view is on screen. The socket follows it. */
  | Readonly<{ type: 'market/observed'; query: MarketSubject | null }>
  | Readonly<{ type: 'market/page_requested'; direction: 'next' | 'previous' }>
  | Readonly<{
      type: 'market/list_requested'
      listing: Omit<ListingRow, 'version'>
      source_amount: number
      merge_sources: readonly string[]
    }>
  | Readonly<{ type: 'market/delist_requested'; listing: ListingRow }>
  | Readonly<{ type: 'market/buy_requested'; listing: ListingRow }>
  | Readonly<{ type: 'market/collect_requested' }>
  | Readonly<{
      type: 'market/write_succeeded'
      operation: 'list' | 'delist' | 'buy'
      listing: ListingRow
      version: string
    }>
  | Readonly<{ type: 'market/write_succeeded'; operation: 'collect' }>
  | Readonly<{ type: 'market/write_failed'; error: string }>

export const initial_marketplace_state = (): MarketplaceState =>
  Object.freeze({
    prices: initial_price_history(),
    types: null,
    next_cursor: null,
    page_cursors: [],
    observation: null,
    requests: 0,
    listings: [],
    ready_request: null,
    recent_pages: [],
    own_listings: [],
    catalogues: {},
    departures: {},
    history: [],
    revenue_30d_mist: '0',
    volume: null,
    history_total: 0,
    profits: [],
    pending: null,
  })

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1_000
const revenue_after_sale = (current: string, sale: Readonly<MarketSaleRow>, known: boolean, now_ms: number): string =>
  known || sale.ts_ms < now_ms - THIRTY_DAYS_MS ? current : String(BigInt(current) + BigInt(sale.price_mist))

const fold_sale = (market: MarketplaceState, sale: Readonly<MarketSaleRow>, now_ms = Date.now()): MarketplaceState => {
  const known = market.history.some(({ id }) => id === sale.id)
  if (known) return market
  const history = known ? market.history : Object.freeze([sale, ...market.history].slice(0, 200))
  return Object.freeze({
    ...market,
    history,
    revenue_30d_mist: revenue_after_sale(market.revenue_30d_mist, sale, known, now_ms),
    history_total: known ? market.history_total : market.history_total + 1,
  })
}

export const market_sale_notice = (
  sale: Readonly<MarketSaleRow>,
  template = 'Sold {{amount}} {{name}} for {{price}}',
  locale = 'en'
): Readonly<{ message: string; parts: readonly ToastPart[] }> => {
  const catalog_name = sale.item_type ? items_by_type[sale.item_type]?.name : null
  const name = sale.name ?? catalog_name ?? (sale.item_type ? titleize(sale.item_type) : sale.object)
  const values: Readonly<Record<string, ToastPart>> = Object.freeze({
    amount: Object.freeze({ text: `×${sale.amount}`, tone: 'gold' }),
    name: Object.freeze({ text: name, tone: 'primary' }),
    price: Object.freeze({ text: `${format_sui(BigInt(sale.price_mist), 2, locale)} SUI`, tone: 'sui' }),
  })
  const parts = Object.freeze(
    template
      .split(/(\{\{(?:amount|name|price)\}\})/)
      .filter(Boolean)
      .map((part) => values[part.slice(2, -2)] ?? Object.freeze({ text: part, tone: 'default' as const }))
  )
  return Object.freeze({ message: parts.map(({ text }) => text).join(''), parts })
}

const same_observation = (left: MarketObservation | null, right: MarketObservation): boolean =>
  left?.request === right.request

const fold_write = (
  market: MarketplaceState,
  input: Extract<MarketplaceInput, { type: 'market/write_succeeded' }>
): MarketplaceState => {
  if (input.operation === 'collect') return Object.freeze({ ...market, pending: null, profits: [] })
  const { version, listing } = input
  const current = market.catalogues[listing.kiosk] ?? { version: '0', owned: false }
  if (BigInt(current.version) > BigInt(version)) return Object.freeze({ ...market, pending: null })
  const catalogues = {
    ...market.catalogues,
    [listing.kiosk]: { version, owned: current.owned || input.operation !== 'buy' },
  }
  const row = { ...listing, version }
  if (input.operation === 'list')
    return Object.freeze({
      ...market,
      pending: null,
      catalogues,
      own_listings: latest_listings(market.own_listings, [row]),
      listings: market.listings,
    })
  return Object.freeze({ ...catalogue_departed({ ...market, catalogues }, listing, version), pending: null })
}

const fold_slice = (
  market: MarketplaceState,
  packet: Readonly<Extract<ServerPacket, { type: 'packet/market_slice' }>>,
  address: string | null
): MarketplaceState => {
  if (!same_observation(market.observation, packet.observation)) return market
  const folded = fold_catalogue(market, packet, false, address)
  return Object.freeze({
    ...folded,
    next_cursor: packet.next_cursor,
    ready_request: packet.observation.request,
    recent_pages: remember_offer_page(market.recent_pages, packet.observation, folded.listings),
  })
}

const fold_packet = (
  market: MarketplaceState,
  packet: Readonly<ServerPacket>,
  address: string | null
): MarketplaceState => {
  if (packet.type === 'packet/server_info' && packet.market_volume !== undefined)
    return Object.freeze({ ...market, volume: packet.market_volume })
  if (packet.type === 'packet/listings') return fold_catalogue(market, packet, true, address)
  if (packet.type === 'packet/market_types') return Object.freeze({ ...market, types: packet.items })
  if (packet.type === 'packet/market_slice') return fold_slice(market, packet, address)
  if (packet.type === 'packet/market_history')
    return Object.freeze({
      ...market,
      history: Object.freeze(packet.sales),
      revenue_30d_mist: packet.revenue_30d_mist,
      history_total: packet.total,
      profits: Object.freeze(packet.profits),
    })
  if (packet.type === 'packet/listing_sold') return fold_sale(market, packet.sale)
  return market
}

/** Asks for a query under the next request number. */
const request = (
  market: MarketplaceState,
  query: MarketSubject
): Pick<MarketplaceState, 'observation' | 'requests'> => ({
  observation: { ...query, request: market.requests + 1 },
  requests: market.requests + 1,
})
const without_page = (market: MarketplaceState, asked: Pick<MarketplaceState, 'observation' | 'requests'>) =>
  Object.freeze({ ...market, ...asked, listings: [], ready_request: null, next_cursor: null, page_cursors: [] })
/** Showing the same query again keeps its page and its offers; another query starts on its first page. */
const observe_subject = (market: MarketplaceState, query: MarketSubject | null): MarketplaceState => {
  if (query === null)
    return market.observation === null ? market : without_page(market, { observation: null, requests: market.requests })
  if (market.observation && market_query_key(market.observation) === market_query_key(query)) return market
  return without_page(market, request(market, query))
}

const turn_page = (market: MarketplaceState, direction: 'next' | 'previous'): MarketplaceState => {
  const { observation } = market
  if (!has_market_page(observation)) return market
  const next = direction === 'next'
  const cursor = next ? market.next_cursor : market.page_cursors.at(-1)
  if (cursor === null || cursor === undefined) return market
  return Object.freeze({
    ...market,
    ...request(market, { ...observation, cursor }),
    page_cursors: next ? [...market.page_cursors, observation.cursor ?? ''] : market.page_cursors.slice(0, -1),
    listings: [],
    ready_request: null,
    next_cursor: null,
  })
}
/** A link that drops or restarts loses the live page: a buy waits for a fresh observation. */
const lose_page_on_link_change = (market: MarketplaceState, input: AppInput): MarketplaceState =>
  ['link/connecting', 'link/rejected', 'link/replaced', 'link/violation', 'link/failed'].includes(input.type)
    ? Object.freeze({ ...market, ready_request: null, listings: [] })
    : market
const reduce_selection = (market: MarketplaceState, input: AppInput): MarketplaceState => {
  if (input.type === 'market/observed') return observe_subject(market, input.query)
  if (input.type === 'market/page_requested') return turn_page(market, input.direction)
  return lose_page_on_link_change(market, input)
}

const LISTING_REQUESTS = ['market/list_requested', 'market/delist_requested', 'market/buy_requested'] as const
/** A listing request needs the account: signed out, nothing waits on it (a buy asks for the sign-in). */
const accepted_listing_request = (
  market: MarketplaceState,
  input: AppInput,
  { wallet, sui_balance_mist }: SiteState['session']
): input is Extract<AppInput, { type: (typeof LISTING_REQUESTS)[number] }> =>
  wallet !== null &&
  LISTING_REQUESTS.some((type) => type === input.type) &&
  'listing' in input &&
  (input.type !== 'market/buy_requested' ||
    (current_offer(market, input.listing) && !market_needs_funding(input.listing.price_mist, sui_balance_mist)))

/** Another viewer: public data is the same for every viewer, so the listed types, the volume and the price
 *  selection stay on screen. The view keeps its query and page under a new request, so the socket asks again. */
const change_viewer = (market: MarketplaceState): MarketplaceState =>
  Object.freeze({
    ...initial_marketplace_state(),
    prices: market.prices,
    types: market.types,
    volume: market.volume,
    ...(market.observation ? request(market, market.observation) : { requests: market.requests }),
    page_cursors: market.page_cursors,
  })

const identity_changed = (state: SiteState, input: AppInput): boolean =>
  input.type === 'auth/disconnected' ||
  input.type === 'auth/rejected' ||
  (input.type === 'auth/connected' && state.session.wallet === input.session)

/** The account's one write in flight: set when a write is accepted, cleared by its outcome. */
const reduce_pending = (market: MarketplaceState, input: AppInput, session: SiteState['session']): MarketplaceState => {
  if (accepted_listing_request(market, input, session)) return Object.freeze({ ...market, pending: input.listing.id })
  if (input.type === 'market/collect_requested') return Object.freeze({ ...market, pending: 'collect' })
  if (input.type === 'market/write_failed') return Object.freeze({ ...market, pending: null })
  if (input.type === 'market/write_succeeded') return Object.freeze({ ...fold_write(market, input), recent_pages: [] })
  return market
}

const reduce_market = (state: SiteState, input: AppInput): MarketplaceState => {
  const market = state.marketplace
  if (identity_changed(state, input)) return change_viewer(market)
  if (input.type === 'server/packet') return fold_packet(market, input.packet, state.session.wallet?.address ?? null)
  const selected = reduce_selection(market, input)
  return selected === market ? reduce_pending(market, input, state.session) : selected
}

const reduce = <S extends SiteState>(state: S, input: AppInput): S => {
  const marketplace = reduce_market(state, input)
  return marketplace === state.marketplace ? state : Object.freeze({ ...state, marketplace })
}

const market_merge_target = (
  state: Readonly<SiteState>,
  operation: 'list' | 'delist' | 'buy',
  listing: Readonly<Omit<ListingRow, 'version'>>
) => {
  if ((operation !== 'buy' && operation !== 'delist') || !listing.item_type) return null
  return stack_merge_target_row(
    state.session.inventory,
    encumbered_asset_ids(state.marketplace.own_listings, state.trade.rows),
    listing.item_type,
    operation === 'delist' ? listing.kiosk : undefined
  )
}

const observe = ({ events, dispatch, get_state, signal }: Parameters<NonNullable<SiteModule['observe']>>[0]): void => {
  const in_flight = new Set<NonNullable<SiteState['session']['wallet']>>()
  const notified_sales = new Set<string>()
  events.on('server/packet', ({ packet }) => {
    if (packet.type !== 'packet/listing_sold' || notified_sales.has(packet.sale.id)) return
    notified_sales.add(packet.sale.id)
    if (notified_sales.size > 200) {
      const oldest = notified_sales.values().next().value
      if (oldest) notified_sales.delete(oldest)
    }
    const copy = get_state().copy?.marketplace_page.sold_toast
    const notice = market_sale_notice(packet.sale, typeof copy === 'string' ? copy : undefined, get_state().locale)
    toast.rich(notice.message, notice.parts, 'success')
  })
  const execute = (
    operation: 'list' | 'delist' | 'buy',
    listing: Readonly<Omit<ListingRow, 'version'>>,
    run: (
      asset: Readonly<{
        kind: 'item' | 'character'
        id: string
        kiosk: string
        price_mist: bigint
        amount?: number
        source_amount?: number
        existing?: string | null
        destination_kiosk?: string | null
        merge_sources?: readonly string[]
      }>
    ) => Promise<Readonly<{ digest: string; listed_id?: string; version: string }>>,
    source_amount?: number
  ): void => {
    const { wallet } = get_state().session
    if (!wallet) return dispatch({ type: 'market/write_failed', error: 'The wallet session is unavailable.' })
    if (in_flight.has(wallet)) return
    in_flight.add(wallet)
    const text = copy_text(get_state().copy?.marketplace_page ?? {})
    const pending = toast.loading(text(`${operation}_pending`))
    const state = get_state()
    const existing = market_merge_target(state, operation, listing)
    void run({
      kind: listing.kind,
      id: listing.id,
      kiosk: listing.kiosk,
      price_mist: BigInt(listing.price_mist),
      ...(listing.kind === 'item' ? { amount: listing.amount, source_amount } : {}),
      ...(operation === 'buy' || operation === 'delist'
        ? { existing: existing?.id ?? null, destination_kiosk: existing?.kiosk ?? null }
        : {}),
    })
      .then(({ listed_id, version }) => {
        pending.success(text(`${operation}_success`))
        if (signal.aborted || get_state().session.wallet !== wallet) return
        dispatch({
          type: 'market/write_succeeded',
          operation,
          version,
          listing: Object.freeze({ ...listing, id: listed_id ?? listing.id, version }),
        })
        dispatch({ type: 'wallet/refresh' })
      })
      .catch((error) => {
        console.error(`Marketplace ${operation} failed.`, error)
        pending.error(error)
        if (signal.aborted || get_state().session.wallet !== wallet) return
        dispatch({ type: 'market/write_failed', error: error instanceof Error ? error.message : String(error) })
      })
      .finally(() => in_flight.delete(wallet))
  }
  events.on('market/list_requested', ({ listing, source_amount, merge_sources }) => {
    const action = get_state().session.wallet?.marketplace.list
    if (action) execute('list', listing, (asset) => action({ ...asset, merge_sources }), source_amount)
  })
  events.on('market/delist_requested', ({ listing }) => {
    const action = get_state().session.wallet?.marketplace.delist
    if (action) execute('delist', listing, action)
  })
  events.on('market/buy_requested', ({ listing }) => {
    const state = get_state()
    const { wallet } = state.session
    if (!wallet) return dispatch({ type: 'auth/login_google' })
    // the roster caps at 6 playable characters — a 7th would land in the kiosk unseen
    if (listing.kind === 'character' && state.session.characters.length >= MAX_TRACKED_CHARACTERS) {
      const reason = copy_text(state.copy?.marketplace_page ?? {})('character_roster_full')
      toast.add(localized_error(reason), 'error')
      return dispatch({ type: 'market/write_failed', error: reason })
    }
    if (!current_offer(state.marketplace, listing)) return
    if (market_needs_funding(listing.price_mist, state.session.sui_balance_mist))
      return dispatch({ type: 'funding/open', cost_mist: buyer_total(BigInt(listing.price_mist)) })
    execute('buy', listing, wallet.marketplace.buy)
  })
  events.on('market/collect_requested', () => {
    const { wallet } = get_state().session
    if (!wallet) return dispatch({ type: 'market/write_failed', error: 'The wallet session is unavailable.' })
    if (in_flight.has(wallet)) return
    in_flight.add(wallet)
    const { marketplace } = wallet
    const text = copy_text(get_state().copy?.marketplace_page ?? {})
    const pending = toast.loading(text('collect_pending'))
    void marketplace
      .collect(get_state().marketplace.profits.map(({ kiosk }) => kiosk))
      .then(() => {
        pending.success(text('collect_success'))
        if (signal.aborted || get_state().session.wallet !== wallet) return
        dispatch({ type: 'market/write_succeeded', operation: 'collect' })
        dispatch({ type: 'wallet/refresh' })
      })
      .catch((error) => {
        console.error('Marketplace proceeds collection failed.', error)
        pending.error(error)
        if (signal.aborted || get_state().session.wallet !== wallet) return
        dispatch({ type: 'market/write_failed', error: error instanceof Error ? error.message : String(error) })
      })
      .finally(() => in_flight.delete(wallet))
  })
  signal.addEventListener(
    'abort',
    () => {
      in_flight.clear()
      notified_sales.clear()
    },
    { once: true }
  )
}

/** The market view's one observation: sent when it changes, and again as soon as a new link is accepted. */
export const market_subscription = (state: SiteState, previous: SiteState): ClientPacket | null => {
  const { observation } = state.marketplace
  if (!link_accepted(state.session.link_status)) return null
  const unchanged = link_accepted(previous.session.link_status)
    ? observation === previous.marketplace.observation
    : observation === null
  return unchanged ? null : { type: 'packet/market_observe', observation }
}

export default Object.freeze({
  name: 'marketplace',
  initial: () => ({ marketplace: initial_marketplace_state() }),
  reduce: (state, input) => reduce_market_prices(reduce(state, input), input),
  observe: (context) => {
    observe(context)
    observe_subscriptions(context, [market_subscription, market_price_subscription])
  },
}) satisfies SiteModule
