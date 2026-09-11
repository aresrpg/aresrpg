// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { LeaderboardMetric } from '@aresrpg/protocol'

/** Retained Hytale leaderboard colors; identities follow the current game vocabulary. */
export const BADGE_COLORS: Readonly<Record<string, readonly [string, string]>> = {
  senshi: ['#C0392B', '#E74C3C'],
  yajin: ['#8E44AD', '#9B59B6'],
  ikari: ['#96281B', '#C0392B'],
  mori: ['#27AE60', '#2ECC71'],
  tokei: ['#2980B9', '#3498DB'],
  shugo: ['#F39C12', '#F1C40F'],
  yogen: ['#16A085', '#1ABC9C'],
  rojin: ['#D35400', '#E67E22'],
  shusen: ['#7F8C8D', '#95A5A6'],
  tomoda: ['#6C3483', '#8E44AD'],
  asobi: ['#A04000', '#D35400'],
  iyashi: ['#1A5276', '#2980B9'],
  FARMER: ['#27AE60', '#2ECC71'],
  HERBALIST: ['#16A085', '#1ABC9C'],
  MINER: ['#7F8C8D', '#95A5A6'],
  FORGER: ['#C0392B', '#E74C3C'],
  CARVER: ['#A04000', '#D35400'],
  TAILOR: ['#8E44AD', '#9B59B6'],
  TANNER: ['#B9770E', '#F39C12'],
  JEWELER: ['#6C3483', '#8E44AD'],
  HANDYMAN: ['#2C3E50', '#34495E'],
  ALCHEMIST: ['#1A5276', '#2980B9'],
  BAKER: ['#D4AC0D', '#F1C40F'],
}

export const display_address = (address: string): string => `${address.slice(0, 6)}…${address.slice(-4)}`

/** A self-subname keeps its full identity in state; only the visible label is shortened. */
export const display_suins_name = (name: string): string => name.replace(/^([a-z0-9-]+)(?:\.\1\.sui|@\1)$/i, '@$1')

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
  const unit = amount >= scale * 1_000_000n ? scale * 1_000_000n : scale * 1_000n
  if (amount < unit) return leaderboard_score(score, metric, locale)
  const tenths = (amount * 10n + unit / 2n) / unit
  const suffix = unit === scale * 1_000_000n ? 'M' : 'K'
  return `${(tenths / 10n).toLocaleString(locale)}.${tenths % 10n}${suffix}${money ? ' SUI' : ''}`
}
