// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { ClientPacket, MarketPriceHistory, MarketPriceObservation } from '@aresrpg/protocol'

import { link_accepted } from '../server_link.ts'
import type { AppInput, SiteState } from '../store.ts'

/** An item's price read: asked for, then its daily history (null when the server keeps none) and its supply. */
export type PriceRead =
  | Readonly<{ status: 'waiting' }>
  | Readonly<{ status: 'read'; history: MarketPriceHistory | null; total_units: string | null }>

export type PriceHistoryState = Readonly<{
  /** The item chart on screen; null while none is. The socket follows it. */
  observation: MarketPriceObservation | null
  read: PriceRead
}>
export type PriceHistoryInput = Readonly<{ type: 'market/price_item_selected'; item_type: string | null }>

const PRICES_WAITING: PriceRead = Object.freeze({ status: 'waiting' })

export const initial_price_history = (): PriceHistoryState => ({ observation: null, read: PRICES_WAITING })

/** The read of one item's prices: waiting until the chart observes that item and its prices arrive. */
export const price_read_of = (prices: PriceHistoryState, item_type: string): PriceRead =>
  prices.observation?.item_type === item_type ? prices.read : PRICES_WAITING

/** The line the chart shows in place of the plot: waiting, nothing kept, or no sale in the period. */
export const price_empty_key = (read: PriceRead, legacy: boolean): string => {
  if (read.status === 'waiting') return 'prices_loading'
  if (read.history === null) return 'prices_unavailable'
  return legacy ? 'prices_legacy' : 'prices_empty'
}

/** A chart that closes and opens again counts from one again: a packet answers it only for the same item and id. */
const select_price_item = (state: PriceHistoryState, item_type: string | null): PriceHistoryState => {
  if (item_type === (state.observation?.item_type ?? null)) return state
  return {
    observation: item_type ? { item_type, id: (state.observation?.id ?? 0) + 1 } : null,
    read: PRICES_WAITING,
  }
}

const fold_price_packet = (
  state: PriceHistoryState,
  packet: Extract<Extract<AppInput, { type: 'server/packet' }>['packet'], { type: 'packet/market_prices' }>
): PriceHistoryState => {
  const { observation, history } = packet
  const same_observation = (['id', 'item_type'] as const).every((key) => state.observation?.[key] === observation[key])
  if (!same_observation) return state
  const shown = state.read.status === 'read' ? state.read.history : null
  if (history && shown && history.sampled_at_ms < shown.sampled_at_ms) return state
  return { ...state, read: { status: 'read', history, total_units: packet.total_units ?? null } }
}

/** Folded only by the existing marketplace reducer. Range selection is local presentation. */
export const fold_price_history = (state: PriceHistoryState, input: AppInput): PriceHistoryState => {
  if (input.type === 'market/price_item_selected') return select_price_item(state, input.item_type)
  if (input.type === 'server/packet' && input.packet.type === 'packet/market_prices')
    return fold_price_packet(state, input.packet)
  return state
}

export const reduce_market_prices = <S extends SiteState>(state: S, input: AppInput): S => {
  const prices = fold_price_history(state.marketplace.prices, input)
  return prices === state.marketplace.prices ? state : { ...state, marketplace: { ...state.marketplace, prices } }
}

/** The item chart's one observation: sent when it changes, and again as soon as a new link is accepted. */
export const market_price_subscription = (state: SiteState, previous: SiteState): ClientPacket | null => {
  const { observation } = state.marketplace.prices
  if (!link_accepted(state.session.link_status)) return null
  const unchanged = link_accepted(previous.session.link_status)
    ? observation === previous.marketplace.prices.observation
    : observation === null
  return unchanged ? null : { type: 'packet/market_prices_observe', observation }
}
