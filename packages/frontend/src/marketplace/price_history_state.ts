// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { ClientPacket, MarketPriceHistory, MarketPriceObservation } from '@aresrpg/protocol'

import type { AppInput, AppState } from '../store.ts'

export type PriceHistoryState = Readonly<{
  observation: MarketPriceObservation | null
  revision: number
  history: MarketPriceHistory | null
  status: 'loading' | 'ready' | 'unavailable'
}>
export type PriceHistoryInput = Readonly<{ type: 'market/price_item_selected'; item_type: string | null }>

export const initial_price_history = (): PriceHistoryState => ({
  observation: null,
  revision: 0,
  history: null,
  status: 'loading',
})

const select_price_item = (state: PriceHistoryState, item_type: string | null): PriceHistoryState => {
  if (item_type === (state.observation?.item_type ?? null)) return state
  const revision = state.revision + 1
  return {
    revision,
    observation: item_type ? { item_type, id: revision } : null,
    history: null,
    status: 'loading',
  }
}

const fold_price_packet = (
  state: PriceHistoryState,
  packet: Extract<Extract<AppInput, { type: 'server/packet' }>['packet'], { type: 'packet/market_prices' }>
): PriceHistoryState => {
  const { observation, history } = packet
  if (observation.id !== state.observation?.id) return state
  if (observation.item_type !== state.observation.item_type) return state
  if (history && state.history && history.sampled_at_ms < state.history.sampled_at_ms) return state
  return { ...state, history, status: history ? 'ready' : 'unavailable' }
}

/** Folded only by the existing marketplace reducer. Range selection is local presentation. */
export const fold_price_history = (state: PriceHistoryState, input: AppInput): PriceHistoryState => {
  if (input.type === 'market/price_item_selected') return select_price_item(state, input.item_type)
  if (input.type === 'server/packet' && input.packet.type === 'packet/market_prices')
    return fold_price_packet(state, input.packet)
  return state
}

export const reduce_market_prices = (state: AppState, input: AppInput): AppState => {
  const prices = fold_price_history(state.marketplace.prices, input)
  return prices === state.marketplace.prices ? state : { ...state, marketplace: { ...state.marketplace, prices } }
}

export const market_price_subscription = (state: AppState, previous: AppState): ClientPacket | null => {
  const open = state.navigation.page === 'marketplace'
  const was_open = previous.navigation.page === 'marketplace'
  if (state.session.link_status !== 'ready' || (!open && !was_open)) return null
  const changed = open !== was_open || state.marketplace.prices.observation !== previous.marketplace.prices.observation
  if (previous.session.link_status === 'ready' && !changed) return null
  return { type: 'packet/market_prices_observe', observation: open ? state.marketplace.prices.observation : null }
}
