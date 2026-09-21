// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { MARKET_PRICE_DAY_MS as DAY, type MarketPriceHistory } from '@aresrpg/protocol'

import {
  fold_price_history,
  initial_price_history,
  market_price_subscription,
} from '../../src/marketplace/price_history_state.ts'
import {
  format_unit_price,
  market_capitalization,
  price_points,
  unit_price_sui,
} from '../../src/marketplace/price_history_model.ts'
import type { AppState } from '../../src/store.ts'

const history: MarketPriceHistory = {
  first_timestamp_ms: 100 * DAY + 1,
  sampled_at_ms: 106 * DAY + 1,
  buckets: [100, 101, 103].map((day) => ({
    at_ms: day * DAY,
    total_mist: '1',
    units: '1000',
    sales: '1',
    checkpoint: day,
  })),
}

test('tiny averages stay nonzero and missing days remain unpriced without fabricated prices', () => {
  expect(unit_price_sui(history.buckets[0]!)).toBe(1e-12)
  expect(format_unit_price(1e-12, 'en')).toBe('0.000000000001')
  const points = price_points(history, 7)
  expect(points.map(({ value }) => value)).toEqual([1e-12, 1e-12, null, 1e-12, null, null, null])
  expect(price_points({ ...history, buckets: [] }, 30).every(({ value }) => value === null)).toBe(true)
  expect(price_points(history, 365)).toHaveLength(365)
})

test('late packets cannot replace another item, an earlier selection, or newer history', () => {
  const first = fold_price_history(initial_price_history(), { type: 'market/price_item_selected', item_type: 'quartz' })
  const second = fold_price_history(first, { type: 'market/price_item_selected', item_type: 'wood' })
  const response = {
    type: 'server/packet' as const,
    packet: { type: 'packet/market_prices' as const, observation: first.observation!, history },
  }
  expect(fold_price_history(second, response)).toBe(second)
  const third = fold_price_history(second, { type: 'market/price_item_selected', item_type: 'quartz' })
  expect(fold_price_history(third, response)).toBe(third)
  const ready = fold_price_history(third, {
    ...response,
    packet: { ...response.packet, observation: third.observation! },
  })
  expect(ready.status).toBe('ready')
  expect(
    fold_price_history(ready, {
      ...response,
      packet: { ...response.packet, observation: third.observation!, history: { ...history, sampled_at_ms: 1 } },
    })
  ).toBe(ready)
  const unavailable = fold_price_history(ready, {
    ...response,
    packet: { ...response.packet, observation: third.observation!, history: null },
  })
  expect(unavailable.status).toBe('unavailable')
  expect(unavailable.history).toBeNull()
  expect(fold_price_history(ready, { type: 'market/price_item_selected', item_type: 'quartz' })).toBe(ready)
  expect(fold_price_history(ready, { type: 'market/price_item_selected', item_type: null }).observation).toBeNull()
})

test('only an authenticated open marketplace observes history; reconnect restores the selection', () => {
  const prices = fold_price_history(initial_price_history(), {
    type: 'market/price_item_selected',
    item_type: 'quartz',
  })
  const state = {
    navigation: { page: 'marketplace' },
    marketplace: { prices },
    session: { link_status: 'ready' },
  } as AppState
  expect(market_price_subscription(state, state)).toBeNull()
  const closed = { ...state, navigation: { ...state.navigation, page: 'characters' as const } }
  expect(market_price_subscription(closed, state)).toEqual({ type: 'packet/market_prices_observe', observation: null })
  expect(market_price_subscription(state, closed)).toEqual({
    type: 'packet/market_prices_observe',
    observation: prices.observation,
  })
  const disconnected = { ...state, session: { ...state.session, link_status: 'connecting' as const } }
  expect(market_price_subscription(disconnected, state)).toBeNull()
  expect(market_price_subscription(state, disconnected)).toEqual({
    type: 'packet/market_prices_observe',
    observation: prices.observation,
  })
})

test('capitalization uses the latest chart average and multiplies exact units before rounding', () => {
  const latest = { ...history.buckets[0]!, at_ms: 105 * DAY, total_mist: '7', units: '3' }
  const priced = { ...history, total_units: '9007199254740993', buckets: [latest, ...history.buckets] }
  expect(market_capitalization(priced)).toBe((9007199254740993n * 7n) / 3n)
  expect(market_capitalization({ ...priced, total_units: '0' })).toBe(0n)
  expect(market_capitalization({ ...priced, total_units: null })).toBeNull()
  expect(market_capitalization({ ...priced, buckets: [] })).toBeNull()
  expect(market_capitalization(null)).toBeNull()
})
