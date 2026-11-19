// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Redis } from 'ioredis'
import { campaign, type Award } from '@aresrpg/immutable/allocation'

export const key = (suffix: string): string => `allocation:${campaign.id}:${suffix}`
export const connect_redis = async (url: string | undefined): Promise<Redis> => {
  if (!url) throw new Error('unavailable')
  const redis = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 5000,
    retryStrategy: () => null,
  })
  redis.on('error', () => console.error('Allocation Redis connection failed'))
  await redis.connect()
  return redis
}
/** The published allocation list. Its order is not the Blast leaf order; `blast_rows` owns that. */
export const read_awards = async (redis: Redis): Promise<readonly Award[]> => {
  const rows = await redis.get(key('awards'))
  return rows ? (JSON.parse(rows) as Award[]) : []
}
