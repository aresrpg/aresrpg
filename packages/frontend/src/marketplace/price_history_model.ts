// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { MARKET_PRICE_DAY_MS, type MarketPriceBucket, type MarketPriceHistory } from '@aresrpg/protocol'

export const PRICE_RANGES = [7, 30, 90, 365] as const
export type PriceRange = (typeof PRICE_RANGES)[number]
export type PricePoint = Readonly<{ at_ms: number; bucket: MarketPriceBucket | null; value: number | null }>

/** Exact integer totals are divided once, at the presentation boundary. */
export const unit_price_sui = (bucket: MarketPriceBucket): number =>
  Number(BigInt(bucket.total_mist)) / Number(BigInt(bucket.units)) / 1_000_000_000

export const price_points = (history: MarketPriceHistory, days: PriceRange): readonly PricePoint[] => {
  const by_day = new Map(history.buckets.map((bucket) => [bucket.at_ms, bucket]))
  const end = Math.floor(history.sampled_at_ms / MARKET_PRICE_DAY_MS) * MARKET_PRICE_DAY_MS
  return Array.from({ length: days }, (_, index) => {
    const at_ms = end - (days - index - 1) * MARKET_PRICE_DAY_MS
    const bucket = by_day.get(at_ms) ?? null
    return { at_ms, bucket, value: bucket ? unit_price_sui(bucket) : null }
  })
}

/** TradingView joins whitespace in one line; separate contiguous runs preserve honest gaps. */
export const price_segments = (points: readonly PricePoint[]): readonly (readonly PricePoint[])[] =>
  points.reduce<PricePoint[][]>((segments, point, index) => {
    if (point.value === null) return segments
    if (index === 0 || points[index - 1]!.value === null) return [...segments, [point]]
    return [...segments.slice(0, -1), [...segments[segments.length - 1]!, point]]
  }, [])

export const format_unit_price = (value: number, locale?: string): string =>
  value.toLocaleString(locale, { maximumSignificantDigits: 6 })

export const price_date = (at_ms: number, locale?: string): string =>
  new Date(at_ms).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
