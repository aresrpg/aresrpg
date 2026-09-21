// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { BusRedis } from '../pubsub_bus.ts'

const FIELDS = [
  'transactions',
  'gas_mist',
  'item_royalty_mist',
  'character_royalty_mist',
  'character_creation_mist',
  'kolizeum_mist',
] as const
export type AnalyticsTotals = Readonly<Record<(typeof FIELDS)[number], string> & { checkpoint: number }>
export const ZERO_TOTALS: AnalyticsTotals = Object.freeze({
  checkpoint: 0,
  transactions: '0',
  gas_mist: '0',
  item_royalty_mist: '0',
  character_royalty_mist: '0',
  character_creation_mist: '0',
  kolizeum_mist: '0',
})

const valid_decimal = (value: unknown, signed: boolean): boolean => {
  if (typeof value !== 'string' || !/^-?\d{1,39}$/.test(value)) return false
  const number = BigInt(value)
  return signed ? number >= -(1n << 127n) && number < 1n << 127n : number >= 0n && number < 1n << 128n
}

export const parse_analytics_totals = (value: string | null): AnalyticsTotals => {
  if (value === null) return ZERO_TOTALS
  const row = JSON.parse(value) as Record<string, unknown>
  if (
    !row ||
    !Number.isSafeInteger(row.checkpoint) ||
    Number(row.checkpoint) < 0 ||
    !FIELDS.every((field) => valid_decimal(row[field], field === 'gas_mist'))
  )
    throw new Error('invalid compact analytics totals')
  return row as AnalyticsTotals
}

export const get_analytics_totals = async (
  redis: Pick<BusRedis, 'get' | 'mget'>,
  keys: readonly string[]
): Promise<readonly AnalyticsTotals[]> => {
  if ((await redis.get('idx:analytics_schema')) !== 'compact-v1')
    throw new Error('compact analytics are not initialized')
  if (!keys.length) return []
  const rows = await redis.mget([...keys])
  if (rows.length !== keys.length) throw new Error('incomplete compact analytics read')
  return rows.map(parse_analytics_totals)
}
