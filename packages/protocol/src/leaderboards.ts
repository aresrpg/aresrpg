// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export const LEADERBOARD_METRICS = [
  'xp',
  'kills',
  'dungeons',
  'jobs',
  'marketplace',
  'kolizeum',
  'zones',
  'feeding',
  'gathering',
] as const
export const LEADERBOARD_LIMIT = 100
export type LeaderboardMetric = (typeof LEADERBOARD_METRICS)[number]
export type LeaderboardObservation = Readonly<{ metric: LeaderboardMetric; id: number }>
export type LeaderboardEntry = Readonly<{
  address: string
  name: string | null
  rank: number
  score: string
  characters: readonly Readonly<{ name: string; classe: string; level: number }>[]
  character_count: number
  jobs: readonly Readonly<{ job: string; level: number }>[]
}>
export type LeaderboardSnapshot = Readonly<{
  observation: LeaderboardObservation
  reset_at_ms: number
  timestamp_ms: number
  checkpoint: number
  entries: readonly LeaderboardEntry[]
  self: LeaderboardEntry | null
}>

const nonnegative_integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0

export const parse_leaderboard_observation = (value: unknown): LeaderboardObservation | null => {
  if (value === null) return null
  if (!value || typeof value !== 'object') throw new Error('invalid leaderboard observation')
  if (Object.keys(value).some((key) => !['metric', 'id'].includes(key)))
    throw new Error('invalid leaderboard observation')
  const { metric, id } = value as Record<string, unknown>
  if (!LEADERBOARD_METRICS.includes(metric as LeaderboardMetric)) throw new Error('invalid leaderboard metric')
  if (!nonnegative_integer(id)) throw new Error('invalid leaderboard request id')
  return { metric: metric as LeaderboardMetric, id: id as number }
}
