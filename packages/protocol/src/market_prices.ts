// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export const MARKET_PRICE_RETENTION_DAYS = 365
export const MARKET_PRICE_DAY_MS = 86_400_000
export type MarketPriceObservation = Readonly<{ item_type: string; id: number }>
export type MarketPriceBucket = Readonly<{
  at_ms: number
  total_mist: string
  units: string
  sales: string
  checkpoint: number
}>
export type MarketPriceHistory = Readonly<{
  first_timestamp_ms: number
  sampled_at_ms: number
  /** Current indexed units across all custody; unavailable supply never suppresses the chart. */
  total_units?: string | null
  buckets: readonly MarketPriceBucket[]
}>

export const parse_market_price_observation = (value: unknown): MarketPriceObservation | null => {
  if (value === null) return null
  if (typeof value !== 'object') throw new Error('invalid market price observation')
  const { item_type, id } = value as Record<string, unknown>
  if (Object.keys(value).some((key) => !['item_type', 'id'].includes(key)))
    throw new Error('invalid market price observation')
  if (typeof item_type !== 'string' || !/^[a-z0-9_]{1,128}$/.test(item_type))
    throw new Error('invalid market price item type')
  if (!Number.isSafeInteger(id) || (id as number) < 0) throw new Error('invalid market price request id')
  return { item_type, id: id as number }
}
