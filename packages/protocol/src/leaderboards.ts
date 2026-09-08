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
export const LEADERBOARD_SEASON_EPOCHS = 30
export const LEADERBOARD_LIMIT = 100
export type LeaderboardMetric = (typeof LEADERBOARD_METRICS)[number]
export type LeaderboardObservation = Readonly<{ metric: LeaderboardMetric; season: number | null; id: number }>
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
  season: number
  current_season: number
  start_epoch: number
  end_epoch: number
  epoch: number
  checkpoint: number
  entries: readonly LeaderboardEntry[]
  self: LeaderboardEntry | null
}>

const nonnegative_integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0

export const parse_leaderboard_observation = (value: unknown): LeaderboardObservation | null => {
  if (value === null) return null
  if (!value || typeof value !== 'object') throw new Error('invalid leaderboard observation')
  const { metric, season, id } = value as Record<string, unknown>
  if (!LEADERBOARD_METRICS.includes(metric as LeaderboardMetric)) throw new Error('invalid leaderboard metric')
  if (season !== null && !nonnegative_integer(season)) throw new Error('invalid leaderboard season')
  if (!nonnegative_integer(id)) throw new Error('invalid leaderboard request id')
  return { metric: metric as LeaderboardMetric, season: season as number | null, id: id as number }
}
