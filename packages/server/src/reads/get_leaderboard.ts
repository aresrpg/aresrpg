// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  LEADERBOARD_LIMIT,
  type LeaderboardEntry,
  type LeaderboardMetric,
  type LeaderboardObservation,
  type LeaderboardSnapshot,
} from '@aresrpg/protocol'

const META_KEY = 'leaderboards:meta'
const PENDING_KEY = 'leaderboards:pending'
const MAX_TOTAL = (1n << 128n) - 1n

type RedisRead = Readonly<{ call?: (command: string, ...args: readonly (string | number)[]) => Promise<unknown> }>
type Meta = Readonly<{ checkpoint: number; timestamp_ms: number; reset_at_ms: number }>

export const rank_member = (score: string, address: string): string =>
  `${(MAX_TOTAL - BigInt(score)).toString().padStart(39, '0')}:${address}`

export const ranked_entry = (member: string, rank: number): LeaderboardEntry => {
  if (!/^\d{39}:0x[0-9a-f]{64}$/.test(member)) throw new Error('invalid leaderboard rank member')
  const score = MAX_TOTAL - BigInt(member.slice(0, 39))
  if (score <= 0n) throw new Error('invalid leaderboard score')
  return {
    address: member.slice(40),
    name: null,
    rank,
    score: String(score),
    characters: [],
    character_count: 0,
    jobs: [],
  }
}

const read_meta = (value: string | null): Meta => {
  if (!value) throw new Error('leaderboard projection is not initialized')
  const meta = JSON.parse(value) as Meta
  if (
    ![meta.checkpoint, meta.timestamp_ms, meta.reset_at_ms].every(
      (value) => Number.isSafeInteger(value) && value >= 0
    ) ||
    meta.timestamp_ms >= meta.reset_at_ms
  )
    throw new Error('invalid leaderboard metadata')
  return meta
}

type Call = NonNullable<RedisRead['call']>

/** One read inside a stable projection: the metadata and pending-batch checks prevent mixed rankings
 *  during checkpoint writes. A read that crossed a checkpoint, or found its rows inconsistent (null),
 *  retries. */
const stable_read = async <T>(redis: RedisRead, read: (call: Call) => Promise<T | null>) => {
  const { call } = redis
  if (!call) throw new Error('leaderboard reads unavailable')
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = (await call('MGET', META_KEY, PENDING_KEY)) as [string | null, string | null]
    if (before[1]) continue
    const meta = read_meta(before[0])
    const value = await read(call)
    const after = (await call('MGET', META_KEY, PENDING_KEY)) as [string | null, string | null]
    if (before[0] === after[0] && !after[1] && value !== null) return { meta, value }
  }
  throw new Error('leaderboard projection is updating')
}

/** The top of one ranking. It names nobody's own row: that is `get_leaderboard_rank`. */
export const get_leaderboard = async (
  redis: RedisRead,
  observation: LeaderboardObservation
): Promise<LeaderboardSnapshot> => {
  const { meta, value: members } = await stable_read(
    redis,
    (call) => call('ZRANGE', `leaderboards:${observation.metric}:rank`, 0, LEADERBOARD_LIMIT - 1) as Promise<string[]>
  )
  return {
    observation,
    reset_at_ms: meta.reset_at_ms,
    timestamp_ms: meta.timestamp_ms,
    checkpoint: meta.checkpoint,
    entries: members.map((member, index) => ranked_entry(member, index + 1)),
    self: null,
  }
}

/** One address's own row in one ranking, or null while it has no score. */
export const get_leaderboard_rank = async (
  redis: RedisRead,
  metric: LeaderboardMetric,
  address: string
): Promise<LeaderboardEntry | null> => {
  const key = `leaderboards:${metric}`
  const { value } = await stable_read(redis, async (call) => {
    const score = (await call('HGET', `${key}:totals`, address)) as string | null
    if (!score) return { entry: null }
    const member = rank_member(score, address)
    const rank = (await call('ZRANK', `${key}:rank`, member)) as number | null
    return rank === null ? null : { entry: ranked_entry(member, rank + 1) }
  })
  return value.entry
}
