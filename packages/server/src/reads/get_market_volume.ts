// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { MarketVolume } from '@aresrpg/protocol'

import type { BusRedis } from '../pubsub_bus.ts'

const DAY_MS = 86_400_000

const subtotal = (value: string) => {
  const match = /^(\d+):(\d+)$/.exec(value)
  if (!match || !Number.isSafeInteger(Number(match[1]))) throw new Error('Invalid marketplace volume subtotal')
  return { timestamp: Number(match[1]), mist: BigInt(match[2]!) }
}

export const get_market_volume = async (
  redis: Pick<BusRedis, 'get' | 'hvals'>,
  now_ms: number
): Promise<MarketVolume | null> => {
  const first = await redis.get('market:volume:first_timestamp')
  if (first === null) return null
  if (!/^\d+$/.test(first) || !Number.isSafeInteger(Number(first))) throw new Error('Invalid marketplace volume start')
  const start = now_ms - 30 * DAY_MS
  const first_day = Math.floor(Math.max(start, Number(first)) / DAY_MS)
  const days = Math.max(0, Math.floor(now_ms / DAY_MS) - first_day + 1)
  const buckets = await Promise.all(
    Array.from({ length: days }, (_, index) => redis.hvals(`market:volume:day:${first_day + index}`))
  )
  const rows = buckets
    .flat()
    .map(subtotal)
    .filter(({ timestamp }) => timestamp <= now_ms)
  const total = (window: number): string | null =>
    Number(first) > now_ms - window
      ? null
      : rows
          .filter(({ timestamp }) => timestamp > now_ms - window)
          .reduce((sum, { mist }) => sum + mist, 0n)
          .toString()
  return { day_mist: total(DAY_MS), month_mist: total(30 * DAY_MS) }
}
