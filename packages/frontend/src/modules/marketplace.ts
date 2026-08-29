// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One marketplace reducer: server projections in, user intents out, SDK receipts re-enter.

import {
  accessory_categories,
  armor_categories,
  tool_categories,
  weapon_categories,
  type ItemCategory,
} from '@aresrpg/immutable'
import {
  MAX_TRACKED_CHARACTERS,
  type ListingRow,
  type MarketCounts,
  type MarketObservation,
  type MarketSaleRow,
  type ServerPacket,
} from '@aresrpg/protocol'

import type { AppInput, AppModule, AppState } from '../store.ts'
import { toast, type ToastPart } from '../toast.ts'
import { copy_text } from '../i18n/copy.ts'
import { encumbered_asset_ids, stack_merge_target_row } from '../inventory_stacks.ts'
import { play_procedural_cue } from '../game/audio/procedural_cues.ts'
import { content_catalog, titleize } from '../content/catalog.ts'
import { format_sui } from '../wallet_amount.ts'

export const MARKET_GROUPS = ['EQUIPMENT', 'PETS', 'RUNES', 'CONSUMABLE', 'RESOURCES', 'CHARACTERS'] as const
export type MarketGroup = (typeof MARKET_GROUPS)[number]

const equipment = Object.freeze([
  ...armor_categories,
  ...accessory_categories,
  ...weapon_categories,
  ...tool_categories,
  'relic',
] as ItemCategory[])

export const market_observation = (group: MarketGroup): MarketObservation =>
  Object.freeze({
    categories: Object.freeze(
      group === 'EQUIPMENT'
        ? equipment
        : group === 'PETS'
          ? ['pet']
          : group === 'RUNES'
            ? ['rune']
            : group === 'CONSUMABLE'
              ? ['consumable', 'key']
              : group === 'RESOURCES'
                ? ['resource']
                : []
    ) as readonly ItemCategory[],
    characters: group === 'CHARACTERS',
  })

export const market_group_count = (group: MarketGroup, counts: Readonly<MarketCounts>, lower_bound = 0): number => {
  const observation = market_observation(group)
  const aggregate = observation.characters
    ? counts.characters
    : observation.categories.reduce((total, category) => total + (counts.categories[category] ?? 0), 0)
  return Math.max(aggregate, lower_bound)
}

export type MarketplaceState = Readonly<{
  group: MarketGroup
  counts: MarketCounts
  observation: MarketObservation | null
  listings: readonly ListingRow[]
  own_listings: readonly ListingRow[]
  history: readonly MarketSaleRow[]
  revenue_30d_mist: string
  history_total: number
  profits: readonly Readonly<{ kiosk: string; amount_mist: string }>[]
  pending: string | null
}>

export type MarketplaceInput =
  | Readonly<{ type: 'market/group_selected'; group: MarketGroup }>
  | Readonly<{
      type: 'market/list_requested'
      listing: ListingRow
      source_amount: number
      merge_sources: readonly string[]
    }>
  | Readonly<{ type: 'market/delist_requested'; listing: ListingRow }>
  | Readonly<{ type: 'market/buy_requested'; listing: ListingRow }>
  | Readonly<{ type: 'market/collect_requested' }>
  | Readonly<{ type: 'market/write_succeeded'; operation: 'list' | 'delist' | 'buy' | 'collect'; listing?: ListingRow }>
  | Readonly<{ type: 'market/write_failed'; error: string }>

export const initial_marketplace_state = (): MarketplaceState =>
  Object.freeze({
    group: 'EQUIPMENT',
    counts: Object.freeze({ categories: Object.freeze({}), characters: 0 }),
    observation: null,
    listings: [],
    own_listings: [],
    history: [],
    revenue_30d_mist: '0',
    history_total: 0,
    profits: [],
    pending: null,
  })

const upsert = (rows: readonly ListingRow[], listing: Readonly<ListingRow>): readonly ListingRow[] =>
  Object.freeze([...rows.filter(({ id }) => id !== listing.id), listing])

const without = (rows: readonly ListingRow[], id: string): readonly ListingRow[] =>
  rows.some((listing) => listing.id === id) ? Object.freeze(rows.filter((listing) => listing.id !== id)) : rows

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1_000
const revenue_after_sale = (current: string, sale: Readonly<MarketSaleRow>, known: boolean, now_ms: number): string =>
  known || sale.ts_ms < now_ms - THIRTY_DAYS_MS ? current : String(BigInt(current) + BigInt(sale.price_mist))

const fold_sale = (market: MarketplaceState, sale: Readonly<MarketSaleRow>, now_ms = Date.now()): MarketplaceState => {
  const known = market.history.some(({ id }) => id === sale.id)
  const listings = without(market.listings, sale.object)
  const own_listings = without(market.own_listings, sale.object)
  if (known && listings === market.listings && own_listings === market.own_listings) return market
  const history = known ? market.history : Object.freeze([sale, ...market.history].slice(0, 200))
  return Object.freeze({
    ...market,
    listings,
    own_listings,
    history,
    revenue_30d_mist: revenue_after_sale(market.revenue_30d_mist, sale, known, now_ms),
    history_total: known ? market.history_total : market.history_total + 1,
  })
}

export const market_sale_notice = (
  sale: Readonly<MarketSaleRow>,
  template = 'Sold {{amount}} {{name}} for {{price}}'
): Readonly<{ message: string; parts: readonly ToastPart[] }> => {
  const catalog_name = sale.item_type ? content_catalog.item(sale.item_type)?.item.name : null
  const name = sale.name ?? catalog_name ?? (sale.item_type ? titleize(sale.item_type) : sale.object)
  const values: Readonly<Record<string, ToastPart>> = Object.freeze({
    amount: Object.freeze({ text: `×${sale.amount}`, tone: 'gold' }),
    name: Object.freeze({ text: name, tone: 'primary' }),
    price: Object.freeze({ text: `${format_sui(BigInt(sale.price_mist), 2)} SUI`, tone: 'sui' }),
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
  !!left &&
  left.characters === right.characters &&
  left.categories.length === right.categories.length &&
  left.categories.every((category, index) => category === right.categories[index])

const listing_is_observed = (observation: MarketObservation | null, listing: Readonly<ListingRow>): boolean =>
  !!observation &&
  (listing.kind === 'character'
    ? observation.characters
    : !!listing.category && (observation.categories as readonly string[]).includes(listing.category))

type ListingPacket = Extract<
  ServerPacket,
  { type: 'packet/market_listed' | 'packet/market_delisted' | 'packet/listing_sold' }
>

const is_listing_packet = (packet: Readonly<ServerPacket>): packet is ListingPacket =>
  packet.type === 'packet/market_listed' ||
  packet.type === 'packet/market_delisted' ||
  packet.type === 'packet/listing_sold'

const fold_listing_packet = (
  market: MarketplaceState,
  packet: Readonly<ListingPacket>,
  address: string | null
): MarketplaceState => {
  if (packet.type === 'packet/listing_sold') return fold_sale(market, packet.sale)
  if (packet.type === 'packet/market_delisted')
    return Object.freeze({
      ...market,
      listings: without(market.listings, packet.object),
      own_listings: without(market.own_listings, packet.object),
    })
  return Object.freeze({
    ...market,
    listings: listing_is_observed(market.observation, packet.listing)
      ? upsert(market.listings, packet.listing)
      : market.listings,
    own_listings: packet.listing.seller === address ? upsert(market.own_listings, packet.listing) : market.own_listings,
  })
}

const fold_packet = (
  market: MarketplaceState,
  packet: Readonly<ServerPacket>,
  address: string | null
): MarketplaceState => {
  if (packet.type === 'packet/listings')
    return Object.freeze({ ...market, own_listings: Object.freeze(packet.listings) })
  if (packet.type === 'packet/market_slice')
    return same_observation(market.observation, packet.observation)
      ? Object.freeze({ ...market, listings: Object.freeze(packet.listings) })
      : market
  if (packet.type === 'packet/market_counts') return Object.freeze({ ...market, counts: packet.counts })
  if (packet.type === 'packet/market_history')
    return Object.freeze({
      ...market,
      history: Object.freeze(packet.sales),
      revenue_30d_mist: packet.revenue_30d_mist,
      history_total: packet.total,
      profits: Object.freeze(packet.profits),
    })
  if (is_listing_packet(packet)) return fold_listing_packet(market, packet, address)
  return market
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
  if (input.type === 'market/group_selected') {
    if (market.group === input.group && market.observation !== null) return state
    return Object.freeze({
      ...state,
      marketplace: Object.freeze({ ...market, group: input.group, observation: market_observation(input.group) }),
    })
  }
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
  if (input.type === 'market/write_succeeded') {
    const { listing } = input
    if (input.operation === 'list' && listing)
      return Object.freeze({
        ...state,
        marketplace: Object.freeze({
          ...market,
          pending: null,
          listings: listing_is_observed(market.observation, listing)
            ? upsert(market.listings, listing)
            : market.listings,
          own_listings: upsert(market.own_listings, listing),
        }),
      })
    if ((input.operation === 'delist' || input.operation === 'buy') && listing)
      return Object.freeze({
        ...state,
        marketplace: Object.freeze({
          ...market,
          pending: null,
          listings: without(market.listings, listing.id),
          own_listings: without(market.own_listings, listing.id),
        }),
      })
    if (input.operation === 'collect')
      return Object.freeze({ ...state, marketplace: Object.freeze({ ...market, pending: null, profits: [] }) })
  }
  return state
}

const market_merge_target = (
  state: Readonly<AppState>,
  operation: 'list' | 'delist' | 'buy',
  listing: Readonly<ListingRow>
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
  const in_flight = new Set<string>()
  const notified_sales = new Set<string>()
  events.on('server/packet', ({ packet }) => {
    if (packet.type !== 'packet/listing_sold' || notified_sales.has(packet.sale.id)) return
    notified_sales.add(packet.sale.id)
    if (notified_sales.size > 200) {
      const oldest = notified_sales.values().next().value
      if (oldest) notified_sales.delete(oldest)
    }
    const copy = get_state().copy?.marketplace_page.sold_toast
    const notice = market_sale_notice(packet.sale, typeof copy === 'string' ? copy : undefined)
    toast.rich(notice.message, notice.parts, 'success')
    play_procedural_cue('sale')
  })
  const execute = (
    operation: 'list' | 'delist' | 'buy',
    listing: Readonly<ListingRow>,
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
    ) => Promise<Readonly<{ digest: string; listed_id?: string }>>,
    source_amount?: number
  ): void => {
    const operation_key = `${operation}:${listing.id}`
    if (in_flight.size > 0) return
    const { wallet } = get_state().session
    if (!wallet) return dispatch({ type: 'market/write_failed', error: 'The wallet session is unavailable.' })
    in_flight.add(operation_key)
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
      .then(({ listed_id }) => {
        pending.success(text(`${operation}_success`))
        dispatch({
          type: 'market/write_succeeded',
          operation,
          listing: listed_id ? Object.freeze({ ...listing, id: listed_id }) : listing,
        })
        dispatch({ type: 'wallet/refresh' })
      })
      .catch((error) => {
        console.error(`Marketplace ${operation} failed.`, error)
        pending.error(error)
        dispatch({ type: 'market/write_failed', error: error instanceof Error ? error.message : String(error) })
      })
      .finally(() => in_flight.delete(operation_key))
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
      toast.add(reason, 'error')
      return dispatch({ type: 'market/write_failed', error: reason })
    }
    const action = state.session.wallet?.marketplace.buy
    if (action) execute('buy', listing, action)
  })
  events.on('market/collect_requested', () => {
    if (in_flight.size > 0) return
    const { wallet } = get_state().session
    if (!wallet) return dispatch({ type: 'market/write_failed', error: 'The wallet session is unavailable.' })
    const operation_key = 'collect'
    in_flight.add(operation_key)
    const { marketplace } = wallet
    const text = copy_text(get_state().copy?.marketplace_page ?? {})
    const pending = toast.loading(text('collect_pending'))
    void marketplace
      .collect(get_state().marketplace.profits.map(({ kiosk }) => kiosk))
      .then(() => {
        pending.success(text('collect_success'))
        dispatch({ type: 'market/write_succeeded', operation: 'collect' })
        dispatch({ type: 'wallet/refresh' })
      })
      .catch((error) => {
        console.error('Marketplace proceeds collection failed.', error)
        pending.error(error)
        dispatch({ type: 'market/write_failed', error: error instanceof Error ? error.message : String(error) })
      })
      .finally(() => in_flight.delete(operation_key))
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

export default Object.freeze({ name: 'marketplace', reduce, observe }) satisfies AppModule
