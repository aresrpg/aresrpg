// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  MARKET_PRICE_DAY_MS,
  type MarketPriceBucket,
  type MarketPriceHistory,
  type MarketUnitPrice,
} from '@aresrpg/protocol'

export const PRICE_RANGES = [7, 30, 90, 365] as const
export type PriceRange = (typeof PRICE_RANGES)[number]
export type PriceCandle = Readonly<{ open: number; high: number; low: number; close: number }>
export type PricePoint = Readonly<{ at_ms: number; bucket: MarketPriceBucket | null; candle: PriceCandle | null }>

/** Exact sale ratios are divided only at the chart boundary. */
const ratio_sui = (price: MarketUnitPrice): number =>
  Number(BigInt(price.mist)) / Number(BigInt(price.units)) / 1_000_000_000

const price_candle = (bucket: MarketPriceBucket | null): PriceCandle | null => {
  const ohlc = bucket?.ohlc
  return ohlc
    ? {
        open: ratio_sui(ohlc.open),
        high: ratio_sui(ohlc.high),
        low: ratio_sui(ohlc.low),
        close: ratio_sui(ohlc.close),
      }
    : null
}

export const price_points = (history: MarketPriceHistory, days: PriceRange): readonly PricePoint[] => {
  const by_day = new Map(history.buckets.map((bucket) => [bucket.at_ms, bucket]))
  const end = Math.floor(history.sampled_at_ms / MARKET_PRICE_DAY_MS) * MARKET_PRICE_DAY_MS
  return Array.from({ length: days }, (_, index) => {
    const at_ms = end - (days - index - 1) * MARKET_PRICE_DAY_MS
    const bucket = by_day.get(at_ms) ?? null
    return { at_ms, bucket, candle: price_candle(bucket) }
  })
}

export const format_unit_price = (value: number, locale?: string): string =>
  value.toLocaleString(locale, { maximumSignificantDigits: 6 })

export const price_date = (at_ms: number, locale?: string): string =>
  new Date(at_ms).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

/** Use the chart's latest traded-day totals, multiplying before division to avoid rounded unit prices. */
export const market_capitalization = (
  history: MarketPriceHistory | null,
  total_units: string | null
): bigint | null => {
  if (!history || total_units === null) return null
  const latest = history.buckets.reduce<MarketPriceBucket | null>(
    (previous, bucket) => (!previous || bucket.at_ms > previous.at_ms ? bucket : previous),
    null
  )
  return latest ? (BigInt(total_units) * BigInt(latest.total_mist)) / BigInt(latest.units) : null
}
