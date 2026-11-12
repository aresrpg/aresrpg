// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { buyer_total } from '@aresrpg/sdk/marketplace'
import type { MarketPriceObservation } from '@aresrpg/protocol'

import type { GameplayContext } from './gameplay_context.ts'
import type { ActorInventory } from './actor_inventory.ts'
import { object_schema, nonempty, decimal, type Schema } from './gameplay_schema.ts'

export const MARKET_PRICE_OBSERVATION_SCHEMA = object_schema({
  item_type: nonempty,
  id: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
})
export const MARKET_PRICE_CONDITION_SCHEMA = object_schema({
  item_type: nonempty,
  metric: {
    oneOf: [
      'lowest_ask_mist',
      'lowest_buyer_total_mist',
      'lowest_unit_mist',
      'latest_sale_unit_mist',
      'latest_daily_unit_mist',
      'total_units',
    ].map((value) => ({ const: value })),
  },
  op: { oneOf: ['eq', 'ne', 'lt', 'lte', 'gt', 'gte'].map((value) => ({ const: value })) },
  value: decimal,
}) satisfies Schema

export type MarketPriceMetric =
  | 'lowest_ask_mist'
  | 'lowest_buyer_total_mist'
  | 'lowest_unit_mist'
  | 'latest_sale_unit_mist'
  | 'latest_daily_unit_mist'
  | 'total_units'
export type MarketPriceCondition = Readonly<{
  item_type: string
  metric: MarketPriceMetric
  op: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte'
  value: string
}>
type Price = Readonly<{ mist: bigint; units: bigint }>
export const market_prices_observed = (observation: MarketPriceObservation, context: GameplayContext) => {
  const current = context.snapshot.inventory?.market_prices?.observation
  return current?.item_type === observation.item_type && current.id === observation.id
}
const history_price = (
  metric: MarketPriceMetric,
  prices: NonNullable<ActorInventory['market_prices']>
): Price | null => {
  if (metric === 'total_units')
    return prices.total_units === null ? null : { mist: BigInt(prices.total_units), units: 1n }
  const [last] = (prices.history?.buckets ?? [])
    .filter(({ units }) => BigInt(units) > 0n)
    .toSorted((a, b) => b.at_ms - a.at_ms)
  if (!last) return null
  if (metric === 'latest_daily_unit_mist') return { mist: BigInt(last.total_mist), units: BigInt(last.units) }
  return last.ohlc ? { mist: BigInt(last.ohlc.close.mist), units: BigInt(last.ohlc.close.units) } : null
}
const offer_price = (item_type: string, metric: MarketPriceMetric, context: GameplayContext): Price | null => {
  const market = context.snapshot.inventory?.market
  if (!market?.complete || market.observation.kind !== 'offers' || market.observation.item_type !== item_type)
    return null
  const rows = market.listings.filter((row) => row.item_type === item_type && row.seller !== context.address)
  const values = rows.map((row) => ({
    mist: metric === 'lowest_ask_mist' ? BigInt(row.price_mist) : buyer_total(BigInt(row.price_mist)),
    units: metric === 'lowest_unit_mist' ? BigInt(row.amount) : 1n,
  }))
  return values.reduce<Price | null>(
    (best, price) => (!best || price.mist * best.units < best.mist * price.units ? price : best),
    null
  )
}
/** Exact ratios preserve unit-price comparisons above Number's safe integer range. History and
 * current asking prices stay distinct facts from their existing independent observations. */
export const market_price = (item_type: string, metric: MarketPriceMetric, context: GameplayContext): Price | null => {
  if (['total_units', 'latest_sale_unit_mist', 'latest_daily_unit_mist'].includes(metric)) {
    const prices = context.snapshot.inventory?.market_prices
    return prices?.observation.item_type === item_type ? history_price(metric, prices) : null
  }
  return offer_price(item_type, metric, context)
}
export const market_price_condition = (condition: MarketPriceCondition, context: GameplayContext): boolean | null => {
  const price = market_price(condition.item_type, condition.metric, context)
  if (!price) return null
  const difference = price.mist - BigInt(condition.value) * price.units
  switch (condition.op) {
    case 'eq':
      return difference === 0n
    case 'ne':
      return difference !== 0n
    case 'lt':
      return difference < 0n
    case 'lte':
      return difference <= 0n
    case 'gt':
      return difference > 0n
    case 'gte':
      return difference >= 0n
  }
}
