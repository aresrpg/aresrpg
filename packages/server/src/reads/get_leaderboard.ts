// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  LEADERBOARD_LIMIT,
  type LeaderboardEntry,
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

const attempt_snapshot = async (
  redis: RedisRead,
  observation: LeaderboardObservation,
  address: string
): Promise<LeaderboardSnapshot | null> => {
  if (!redis.call) throw new Error('leaderboard reads unavailable')
  const before = (await redis.call('MGET', META_KEY, PENDING_KEY)) as [string | null, string | null]
  if (before[1]) return null
  const meta = read_meta(before[0])
  const key = `leaderboards:${observation.metric}`
  const ranking = await read_ranking(redis, key, address)
  const after = (await redis.call('MGET', META_KEY, PENDING_KEY)) as [string | null, string | null]
  if (before[0] !== after[0] || after[1] || !ranking) return null
  return {
    observation,
    reset_at_ms: meta.reset_at_ms,
    timestamp_ms: meta.timestamp_ms,
    checkpoint: meta.checkpoint,
    ...ranking,
  }
}

const read_ranking = async (
  redis: RedisRead,
  key: string,
  address: string
): Promise<Pick<LeaderboardSnapshot, 'entries' | 'self'> | null> => {
  if (!redis.call) throw new Error('leaderboard reads unavailable')
  const [members, score] = await Promise.all([
    redis.call('ZRANGE', `${key}:rank`, 0, LEADERBOARD_LIMIT - 1) as Promise<string[]>,
    redis.call('HGET', `${key}:totals`, address) as Promise<string | null>,
  ])
  const entries = members.map((member, index) => ranked_entry(member, index + 1))
  if (!score) return { entries, self: null }
  const member = rank_member(score, address)
  const rank = (await redis.call('ZRANK', `${key}:rank`, member)) as number | null
  if (rank === null) return null
  return { entries, self: ranked_entry(member, rank + 1) }
}

/** The metadata and pending-batch checks prevent mixed rankings during checkpoint writes. */
export const get_leaderboard = async (
  redis: RedisRead,
  observation: LeaderboardObservation,
  address: string
): Promise<LeaderboardSnapshot> => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const snapshot = await attempt_snapshot(redis, observation, address)
    if (snapshot) return snapshot
  }
  throw new Error('leaderboard projection is updating')
}
