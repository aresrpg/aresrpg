// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Redis } from 'ioredis'
import { campaign, type Award, type SpotProof } from '@aresrpg/immutable/allocation'

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
/** The published allocation list. */
export const read_awards = async (redis: Redis): Promise<readonly Award[]> => {
  const rows = await redis.get(key('awards'))
  return rows ? (JSON.parse(rows) as Award[]) : []
}
/** Blast's allowlist proofs by wallet, written once by `allocation_campaign.ts proofs`. Blast owns
 * the full list, so only Blast can issue them; a sale's allowlist never changes after creation. */
export const read_proofs = async (redis: Redis): Promise<Readonly<Record<string, SpotProof>>> => {
  const rows = await redis.get(key('proofs'))
  return rows ? (JSON.parse(rows) as Record<string, SpotProof>) : {}
}
