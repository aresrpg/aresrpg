// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One marketplace reducer: server projections in, user intents out, SDK receipts re-enter.

import {
  accessory_categories,
  armor_categories,
  cosmetic_item_categories,
  tool_categories,
  weapon_categories,
  type ItemCategory,
} from '@aresrpg/immutable'
import type { ListingRow, MarketObservation, MarketSaleRow, ServerPacket } from '@aresrpg/protocol'

import type { AppInput, AppModule, AppState } from '../store.ts'
import { toast } from '../toast.ts'
import { copy_text } from '../i18n/copy.ts'
import { stack_merge_target_row } from '../inventory_stacks.ts'

export const MARKET_GROUPS = [
  'COSMETICS',
  'EQUIPMENT',
  'PETS',
  'RUNES',
  'CONSUMABLE',
  'RESOURCES',
  'CHARACTERS',
] as const
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
      group === 'COSMETICS'
        ? [...cosmetic_item_categories]
        : group === 'EQUIPMENT'
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

export type MarketplaceState = Readonly<{
  group: MarketGroup
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
  Object.freeze(rows.filter((listing) => listing.id !== id))

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
  if (packet.type === 'packet/market_history')
    return Object.freeze({
      ...market,
      history: Object.freeze(packet.sales),
      revenue_30d_mist: packet.revenue_30d_mist,
      history_total: packet.total,
      profits: Object.freeze(packet.profits),
    })
  if (packet.type === 'packet/market_listed')
    return Object.freeze({
      ...market,
      listings: listing_is_observed(market.observation, packet.listing)
        ? upsert(market.listings, packet.listing)
        : market.listings,
      own_listings:
        packet.listing.seller === address ? upsert(market.own_listings, packet.listing) : market.own_listings,
    })
  if (packet.type === 'packet/market_delisted' || packet.type === 'packet/listing_sold')
    return Object.freeze({
      ...market,
      listings: without(market.listings, packet.object),
      own_listings: without(market.own_listings, packet.object),
    })
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

const observe = ({ events, dispatch, get_state }: Parameters<NonNullable<AppModule['observe']>>[0]): void => {
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
    const { wallet } = get_state().session
    if (!wallet) return dispatch({ type: 'market/write_failed', error: 'The wallet session is unavailable.' })
    const text = copy_text(get_state().copy?.marketplace_page ?? {})
    const pending = toast.loading(text(`${operation}_pending`))
    const state = get_state()
    const existing =
      (operation === 'buy' || operation === 'delist') && listing.item_type
        ? stack_merge_target_row(
            state.session.inventory,
            state.marketplace.own_listings,
            listing.item_type,
            operation === 'delist' ? listing.kiosk : undefined
          )
        : null
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
    const action = get_state().session.wallet?.marketplace.buy
    if (action) execute('buy', listing, action)
  })
  events.on('market/collect_requested', () => {
    const { wallet } = get_state().session
    if (!wallet) return dispatch({ type: 'market/write_failed', error: 'The wallet session is unavailable.' })
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
  })
}

export default Object.freeze({ name: 'marketplace', reduce, observe }) satisfies AppModule
