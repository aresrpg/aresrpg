// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  MARKET_PRICE_DAY_MS,
  MARKET_PRICE_RETENTION_DAYS,
  type MarketPriceBucket,
  type MarketPriceHistory,
  type MarketUnitPrice,
  type MarketOhlc,
} from '@aresrpg/protocol'

import type { BusRedis } from '../pubsub_bus.ts'

const positive_total = (value: unknown): value is string =>
  typeof value === 'string' && /^[1-9]\d{0,38}$/.test(value) && BigInt(value) <= (1n << 128n) - 1n

const parse_unit_price = (value: unknown): MarketUnitPrice => {
  if (!value || typeof value !== 'object') throw new Error('invalid marketplace unit price')
  const { mist, units } = value as Record<string, unknown>
  if (![mist, units].every((part) => positive_total(part) && BigInt(part) <= (1n << 64n) - 1n))
    throw new Error('invalid marketplace unit price')
  return { mist: mist as string, units: units as string }
}

const price_at_most = (left: MarketUnitPrice, right: MarketUnitPrice): boolean =>
  BigInt(left.mist) * BigInt(right.units) <= BigInt(right.mist) * BigInt(left.units)

const parse_ohlc = (value: unknown): MarketOhlc => {
  if (!value || typeof value !== 'object') throw new Error('invalid marketplace candle')
  const row = value as Record<string, unknown>
  const candle = {
    open: parse_unit_price(row.open),
    high: parse_unit_price(row.high),
    low: parse_unit_price(row.low),
    close: parse_unit_price(row.close),
  }
  if (!Object.values(candle).every((price) => price_at_most(candle.low, price) && price_at_most(price, candle.high)))
    throw new Error('invalid marketplace candle range')
  return candle
}

export const parse_price_bucket = (value: unknown, at_ms: number): MarketPriceBucket | null => {
  if (value === null) return null
  if (typeof value !== 'string') throw new Error('invalid marketplace price bucket')
  const row = JSON.parse(value) as Record<string, unknown>
  if (
    !row ||
    !['total_mist', 'units', 'sales'].every((key) => positive_total(row[key])) ||
    !Number.isSafeInteger(row.checkpoint) ||
    (row.checkpoint as number) < 0
  )
    throw new Error('invalid marketplace price totals')
  return {
    at_ms,
    total_mist: row.total_mist as string,
    units: row.units as string,
    sales: row.sales as string,
    checkpoint: row.checkpoint as number,
    ...(row.ohlc === undefined ? {} : { ohlc: parse_ohlc(row.ohlc) }),
  }
}

export const get_market_prices = async (
  redis: Readonly<Pick<BusRedis, 'get' | 'pipeline'>>,
  item_type: string,
  now_ms: number
): Promise<MarketPriceHistory | null> => {
  const first = await redis.get('market:prices:first_timestamp')
  if (first === null) return null
  if (!/^\d+$/.test(first) || !Number.isSafeInteger(Number(first)) || Number(first) > now_ms)
    throw new Error('invalid marketplace price start')
  const end_day = Math.floor(now_ms / MARKET_PRICE_DAY_MS)
  const start_day = Math.max(Math.floor(Number(first) / MARKET_PRICE_DAY_MS), end_day - MARKET_PRICE_RETENTION_DAYS)
  const days = Array.from({ length: end_day - start_day + 1 }, (_, index) => start_day + index)
  const reads = redis.pipeline()
  days.forEach((day) => reads.hget(`market:prices:day:${day}`, item_type))
  const results = await reads.exec()
  if (!results || results.length !== days.length) throw new Error('incomplete marketplace price read')
  const buckets = results.flatMap(([error, value], index) => {
    if (error) throw error
    const bucket = parse_price_bucket(value, days[index]! * MARKET_PRICE_DAY_MS)
    return bucket ? [bucket] : []
  })
  return { first_timestamp_ms: Number(first), sampled_at_ms: now_ms, buckets }
}

/** Average unit sale price change from `from` to `to`, in basis points, truncated toward zero. */
const change_bps = (from: MarketPriceBucket, to: MarketPriceBucket): number => {
  const before = BigInt(from.total_mist) * BigInt(to.units)
  return Number(((BigInt(to.total_mist) * BigInt(from.units) - before) * 10_000n) / before)
}

/** Per item type, the last full UTC day's average unit sale price against the day before, from the
 *  stored daily buckets in two hash reads. A type that did not sell on both days has no entry. */
export const get_market_changes = async (
  redis: Readonly<Pick<BusRedis, 'hgetall'>>,
  now_ms: number
): Promise<Readonly<Record<string, number>>> => {
  const day = Math.floor(now_ms / MARKET_PRICE_DAY_MS) - 1
  const [last, before] = await Promise.all([
    redis.hgetall(`market:prices:day:${day}`),
    redis.hgetall(`market:prices:day:${day - 1}`),
  ])
  return Object.fromEntries(
    Object.entries(last).flatMap(([item_type, raw]) => {
      const from = parse_price_bucket(before[item_type] ?? null, (day - 1) * MARKET_PRICE_DAY_MS)
      const to = parse_price_bucket(raw, day * MARKET_PRICE_DAY_MS)
      return from && to ? [[item_type, change_bps(from, to)]] : []
    })
  )
}
