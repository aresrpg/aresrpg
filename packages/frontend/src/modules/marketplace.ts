// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One marketplace reducer: server projections in, user intents out, SDK receipts re-enter.

import { equipment_categories, type ItemCategory } from '@aresrpg/immutable'
import {
  MAX_TRACKED_CHARACTERS,
  type ListingRow,
  type MarketType,
  type MarketTypeCounts,
  type MarketQuery,
  market_category,
  has_market_page,
  type MarketVolume,
  type MarketObservation,
  type MarketSaleRow,
  type MarketSnapshot,
  type ServerPacket,
} from '@aresrpg/protocol'

import { localized_error } from '../i18n/error_text.ts'
import {
  initial_price_history,
  reduce_market_prices,
  type PriceHistoryState,
  type PriceHistoryInput,
} from '../marketplace/price_history_state.ts'
import type { AppInput, AppModule, AppState } from '../store.ts'
import { toast, type ToastPart } from '../toast.ts'
import { copy_text } from '../i18n/copy.ts'
import { encumbered_asset_ids, stack_merge_target_row } from '../inventory_stacks.ts'
import { play_procedural_cue } from '../game/audio/procedural_cues.ts'
import { content_catalog, titleize } from '../content/catalog.ts'
import { format_sui } from '../wallet_amount.ts'

export const MARKET_GROUPS = ['EQUIPMENT', 'PETS', 'RUNES', 'CONSUMABLE', 'RESOURCES', 'CHARACTERS'] as const
export type MarketGroup = (typeof MARKET_GROUPS)[number]

const equipment = Object.freeze(equipment_categories.filter((category) => category !== 'pet'))

const MARKET_CATEGORIES: Readonly<Record<MarketGroup, readonly ItemCategory[]>> = Object.freeze({
  EQUIPMENT: equipment,
  PETS: ['pet'],
  RUNES: ['rune'],
  CONSUMABLE: ['consumable', 'key'],
  RESOURCES: ['resource'],
  CHARACTERS: [],
})
export const market_categories = (group: MarketGroup): readonly ItemCategory[] => MARKET_CATEGORIES[group]

export type MarketplaceState = Readonly<{
  prices: PriceHistoryState
  group: MarketGroup
  types: readonly MarketType[]
  type_counts: MarketTypeCounts | null
  next_cursor: string | null
  page_cursors: readonly string[]
  observation: MarketObservation | null
  listings: readonly ListingRow[]
  own_listings: readonly ListingRow[]
  catalogues: Readonly<Record<string, Readonly<{ version: string; owned: boolean }>>>
  departures: Readonly<Record<string, Readonly<Record<string, string>>>>
  history: readonly MarketSaleRow[]
  revenue_30d_mist: string
  volume: MarketVolume | null
  history_total: number
  profits: readonly Readonly<{ kiosk: string; amount_mist: string }>[]
  pending: string | null
}>

export type MarketplaceInput =
  | PriceHistoryInput
  | Readonly<{ type: 'market/opened' }>
  | Readonly<{ type: 'market/group_selected'; group: MarketGroup; category?: ItemCategory; item_type?: string }>
  | Readonly<{ type: 'market/page_requested'; direction: 'next' | 'previous' }>
  | Readonly<{ type: 'market/characters_filtered'; classe?: string; min_level?: number; max_level?: number }>
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
    group: 'EQUIPMENT',
    types: [],
    type_counts: null,
    next_cursor: null,
    page_cursors: [],
    observation: null,
    listings: [],
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

const latest_listings = (current: readonly ListingRow[], incoming: readonly ListingRow[]): readonly ListingRow[] => {
  const rows = new Map(current.map((row) => [row.id, row]))
  incoming.forEach((row) => {
    if (BigInt(row.version) >= BigInt(rows.get(row.id)?.version ?? '0')) rows.set(row.id, row)
  })
  return Object.freeze([...rows.values()])
}

const without_relation = (rows: readonly ListingRow[], gone: Readonly<ListingRow>): readonly ListingRow[] =>
  rows.filter((row) => row.id !== gone.id || row.kiosk !== gone.kiosk)

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
  const catalog_name = sale.item_type ? content_catalog.item(sale.item_type)?.item.name : null
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

const fold_catalogue = (
  market: MarketplaceState,
  snapshot: Readonly<MarketSnapshot>,
  own: boolean,
  address: string | null
): MarketplaceState => {
  const current_source = (kiosk: string): boolean =>
    BigInt(snapshot.kiosk_versions[kiosk] ?? '0') >= BigInt(market.catalogues[kiosk]?.version ?? '0')
  const incoming = snapshot.listings.filter(
    (row) => current_source(row.kiosk) && BigInt(row.version) > BigInt(market.departures[row.kiosk]?.[row.id] ?? '-1')
  )
  const previous = own ? market.own_listings : market.listings
  const rows = latest_listings(
    previous.filter((row) =>
      own
        ? BigInt(snapshot.kiosk_versions[row.kiosk] ?? '0') <= BigInt(market.catalogues[row.kiosk]?.version ?? '0')
        : !current_source(row.kiosk)
    ),
    incoming
  )
  const own_listings = own
    ? rows
    : latest_listings(
        market.own_listings,
        incoming.filter((row) => row.seller === address)
      )
  const public_rows = own ? market.listings : rows
  const owned_relations = new Set([...market.own_listings, ...own_listings].map((row) => `${row.kiosk}:${row.id}`))
  const listings = Object.freeze(
    public_rows.filter((row) => row.seller !== address && !owned_relations.has(`${row.kiosk}:${row.id}`))
  )
  const departures = Object.fromEntries(
    Object.entries(market.departures).flatMap(([kiosk, removed]) => {
      const retained = Object.fromEntries(
        Object.entries(removed).filter(
          ([, version]) => BigInt(version) > BigInt(snapshot.kiosk_versions[kiosk] ?? '-1')
        )
      )
      return Object.keys(retained).length ? [[kiosk, retained]] : []
    })
  )
  const versions = {
    ...market.catalogues,
    ...Object.fromEntries(
      Object.entries(snapshot.kiosk_versions).map(([kiosk, version]) => [
        kiosk,
        {
          version: current_source(kiosk) ? version : market.catalogues[kiosk]!.version,
          owned: own || !!market.catalogues[kiosk]?.owned,
        },
      ])
    ),
  }
  const observed = new Set([
    ...listings.map(({ kiosk }) => kiosk),
    ...Object.keys(snapshot.kiosk_versions),
    ...Object.keys(departures),
  ])
  const catalogues = Object.fromEntries(
    Object.entries(versions).filter(([kiosk, value]) => value.owned || observed.has(kiosk))
  )
  return Object.freeze({ ...market, own_listings, listings, catalogues, departures })
}

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
  return Object.freeze({
    ...market,
    pending: null,
    catalogues,
    departures: {
      ...market.departures,
      [listing.kiosk]: { ...market.departures[listing.kiosk], [listing.id]: version },
    },
    own_listings: without_relation(market.own_listings, listing),
    listings: without_relation(market.listings, listing),
  })
}

const BROWSE_PACKETS = ['packet/market_slice', 'packet/market_types', 'packet/market_counts'] as const
type BrowsePacket = Readonly<Extract<ServerPacket, { type: (typeof BROWSE_PACKETS)[number] }>>
const is_browse_packet = (packet: Readonly<ServerPacket>): packet is BrowsePacket =>
  BROWSE_PACKETS.some((type) => type === packet.type)

const fold_browse = (market: MarketplaceState, packet: BrowsePacket, address: string | null): MarketplaceState => {
  if (!same_observation(market.observation, packet.observation)) return market
  if (packet.type === 'packet/market_counts') return Object.freeze({ ...market, type_counts: packet.counts })
  return packet.type === 'packet/market_slice'
    ? Object.freeze({ ...fold_catalogue(market, packet, false, address), next_cursor: packet.next_cursor })
    : Object.freeze({ ...market, types: packet.items })
}

const fold_packet = (
  market: MarketplaceState,
  packet: Readonly<ServerPacket>,
  address: string | null
): MarketplaceState => {
  if (packet.type === 'packet/server_info' && packet.market_volume !== undefined)
    return Object.freeze({ ...market, volume: packet.market_volume })
  if (packet.type === 'packet/listings') return fold_catalogue(market, packet, true, address)
  if (is_browse_packet(packet)) return fold_browse(market, packet, address)
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

const select_query = (market: MarketplaceState, query: MarketQuery, group = market.group): MarketplaceState =>
  Object.freeze({
    ...market,
    group,
    observation: { ...query, request: (market.observation?.request ?? 0) + 1 },
    types: market_category(market.observation) === market_category(query) ? market.types : [],
    listings: [],
    next_cursor: null,
    page_cursors: [],
  })
const turn_page = (market: MarketplaceState, direction: 'next' | 'previous'): MarketplaceState => {
  const { observation } = market
  if (!has_market_page(observation)) return market
  const next = direction === 'next'
  const cursor = next ? market.next_cursor : market.page_cursors.at(-1)
  if (cursor === null || cursor === undefined) return market
  return Object.freeze({
    ...market,
    observation: { ...observation, cursor, request: market.observation!.request + 1 },
    page_cursors: next ? [...market.page_cursors, observation.cursor ?? ''] : market.page_cursors.slice(0, -1),
    listings: [],
    next_cursor: null,
  })
}
const group_query = (input: Extract<MarketplaceInput, { type: 'market/group_selected' }>): MarketQuery => {
  if (input.group === 'CHARACTERS') return { kind: 'characters' }
  const category = input.category ?? market_categories(input.group)[0]!
  return input.item_type ? { kind: 'offers', category, item_type: input.item_type } : { kind: 'types', category }
}
const reduce_selection = (market: MarketplaceState, input: AppInput): MarketplaceState => {
  switch (input.type) {
    case 'market/opened':
      return market.observation ? market : select_query(market, { kind: 'overview' })
    case 'market/group_selected':
      return select_query(market, group_query(input), input.group)
    case 'market/characters_filtered':
      return select_query(market, {
        kind: 'characters',
        classe: input.classe,
        min_level: input.min_level,
        max_level: input.max_level,
      })
    case 'market/page_requested':
      return turn_page(market, input.direction)
    default:
      return market
  }
}

const reduce = (state: AppState, input: AppInput): AppState => {
  const market = state.marketplace
  if (
    input.type === 'auth/disconnected' ||
    input.type === 'auth/rejected' ||
    (input.type === 'auth/connected' && state.session.wallet === input.session)
  )
    return Object.freeze({ ...state, marketplace: initial_marketplace_state() })
  if (input.type === 'server/packet') {
    const next = fold_packet(market, input.packet, state.session.wallet?.address ?? null)
    return next === market ? state : Object.freeze({ ...state, marketplace: next })
  }
  const selected = reduce_selection(market, input)
  if (selected !== market) return Object.freeze({ ...state, marketplace: selected })

  if (
    input.type === 'market/list_requested' ||
    input.type === 'market/delist_requested' ||
    input.type === 'market/buy_requested'
  )
    return Object.freeze({ ...state, marketplace: Object.freeze({ ...market, pending: input.listing.id }) })
  if (input.type === 'market/collect_requested')
    return Object.freeze({ ...state, marketplace: Object.freeze({ ...market, pending: 'collect' }) })
  if (input.type === 'market/write_failed')
    return Object.freeze({ ...state, marketplace: Object.freeze({ ...market, pending: null }) })
  if (input.type === 'market/write_succeeded')
    return Object.freeze({ ...state, marketplace: fold_write(market, input) })
  return state
}

const market_merge_target = (
  state: Readonly<AppState>,
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

const observe = ({ events, dispatch, get_state, signal }: Parameters<NonNullable<AppModule['observe']>>[0]): void => {
  const in_flight = new Set<NonNullable<AppState['session']['wallet']>>()
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
    play_procedural_cue('sale')
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
    // the roster caps at 6 playable characters — a 7th would land in the kiosk unseen
    if (listing.kind === 'character' && state.session.characters.length >= MAX_TRACKED_CHARACTERS) {
      const reason = copy_text(state.copy?.marketplace_page ?? {})('character_roster_full')
      toast.add(localized_error(reason), 'error')
      return dispatch({ type: 'market/write_failed', error: reason })
    }
    const action = state.session.wallet?.marketplace.buy
    if (action) execute('buy', listing, action)
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

export default Object.freeze({
  name: 'marketplace',
  reduce: (state, input) => reduce_market_prices(reduce(state, input), input),
  observe,
}) satisfies AppModule
