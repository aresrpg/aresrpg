// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  MARKET_PRICE_DAY_MS,
  MARKET_PRICE_RETENTION_DAYS,
  type MarketPriceBucket,
  type MarketPriceHistory,
} from '@aresrpg/protocol'

import type { BusRedis } from '../pubsub_bus.ts'

const positive_total = (value: unknown): value is string =>
  typeof value === 'string' && /^[1-9]\d{0,38}$/.test(value) && BigInt(value) <= (1n << 128n) - 1n

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
  if (!redis.pipeline) throw new Error('marketplace price reader unavailable')
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
