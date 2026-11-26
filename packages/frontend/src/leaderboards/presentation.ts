// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { application_suins_name, display_address, display_suins_name } from '@aresrpg/immutable'
import type { LeaderboardMetric, LeaderboardEntry } from '@aresrpg/protocol'

export const leaderboard_score = (score: string, metric: LeaderboardMetric, locale: string): string => {
  const amount = BigInt(score)
  if (metric !== 'marketplace' && metric !== 'kolizeum') return amount.toLocaleString(locale)
  const whole = (amount / 1_000_000_000n).toLocaleString(locale)
  const fraction = (amount % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '')
  const separator =
    new Intl.NumberFormat(locale).formatToParts(1.1).find(({ type }) => type === 'decimal')?.value ?? '.'
  return `${whole}${fraction ? `${separator}${fraction}` : ''} SUI`
}

/** Hytale's compact K/M scores; the row tooltip retains the exact amount. */
export const compact_leaderboard_score = (score: string, metric: LeaderboardMetric, locale: string): string => {
  const amount = BigInt(score)
  const money = metric === 'marketplace' || metric === 'kolizeum'
  const scale = money ? 1_000_000_000n : 1n
  if (amount < scale * 1_000n) return leaderboard_score(score, metric, locale)
  const formatted = new Intl.NumberFormat(locale, {
    notation: 'compact',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Number(amount) / Number(scale))
  return `${formatted}${money ? ' SUI' : ''}`
}

/** Whether a ranked account is a hosted bot: its name is in the bots' own name space. */
export const is_agent_entry = (entry: Pick<LeaderboardEntry, 'name'>): boolean =>
  !!entry.name && application_suins_name(entry.name)?.kind === 'agent'

/** The name a ranked account goes by. What kind of account it is is a badge beside it, not part of the name. */
export const player_name = (entry: Pick<LeaderboardEntry, 'address' | 'name'>): string =>
  entry.name ? display_suins_name(entry.name) : display_address(entry.address)
