// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
export const LEADERBOARD_CATEGORIES = ['XP', 'KILLS', 'TIME_PLAYED', 'DUNGEONS', 'SUI_SPENT', 'JOBS'] as const
export const TIMEFRAMES = ['DAILY', 'WEEKLY', 'MONTHLY', 'ALL TIME'] as const
export const TIMEFRAME_KEYS: Record<string, string> = {
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  'ALL TIME': 'alltime',
}
export const CATEGORY_KEYS: Record<string, string> = {
  XP: 'xp',
  KILLS: 'kills',
  TIME_PLAYED: 'time_played',
  DUNGEONS: 'dungeons',
  SUI_SPENT: 'sui_spent',
  JOBS: 'jobs',
}
export const ALLTIME_ONLY_CATEGORIES = new Set(['TIME_PLAYED', 'DUNGEONS', 'SUI_SPENT', 'JOBS'])
export const SCORE_HIDDEN_CATEGORIES = new Set(['SUI_SPENT'])

export function format_score(score: bigint, category: string): string {
  if (category === 'sui_spent') return ''
  const n = Number(score)
  if (category === 'jobs') return n.toLocaleString()
  if (category === 'time_played') return `${n.toLocaleString()}h`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}
