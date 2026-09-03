// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { experience_progress } from '@aresrpg/immutable'

import type { FightResult, ResultParticipant } from './fight_result.ts'

export type FightSettlementProgress = Readonly<{
  completed: number
  total: number
  failed_character: string | null
}>

export const fight_settlement_progress = (
  results: Readonly<Record<string, FightResult>>,
  fight: string
): FightSettlementProgress => {
  const eligible = Object.entries(results).filter(([, result]) => {
    if (result.fight !== fight || result.own_seat === null) return false
    return result.participants[result.own_seat]?.forfeited === false
  })
  return Object.freeze({
    completed: eligible.filter(([, result]) => result.settlement_confirmed).length,
    total: eligible.length,
    failed_character: eligible.find(([, result]) => result.error !== null)?.[0] ?? null,
  })
}

export const fight_result_available = (
  fight: Readonly<{ checkpoint: Readonly<{ contract: Readonly<{ id: string }> }> | null }>,
  result_fight: string
): boolean => fight.checkpoint?.contract.id !== result_fight

export const fight_resolution_dungeon = (
  row: Readonly<{ dungeon?: unknown; dungeon_room?: unknown }>
): Readonly<{ dungeon: string; room: number }> | null => {
  if (row.dungeon === null || row.dungeon === undefined) return null
  if (
    typeof row.dungeon !== 'string' ||
    row.dungeon.length === 0 ||
    !Number.isSafeInteger(row.dungeon_room) ||
    Number(row.dungeon_room) < 0
  )
    throw new Error('Fight resolution carries an incomplete dungeon identity.')
  return Object.freeze({ dungeon: row.dungeon, room: Number(row.dungeon_room) })
}

export const fight_result_surface = (
  result: Readonly<Pick<FightResult, 'result_open' | 'level_up_open'>>
): 'result' | 'level_up' | null => (result.result_open ? 'result' : result.level_up_open ? 'level_up' : null)

export const kolizeum_wager_outcome = (
  wager: Readonly<{ stake_mist: bigint; payout_mist: bigint | null }> | null
): Readonly<{ kind: 'won' | 'lost' | 'even'; mist: bigint }> | null => {
  if (!wager || wager.payout_mist === null) return null
  if (wager.payout_mist > 0n) return Object.freeze({ kind: 'won', mist: wager.payout_mist })
  return wager.stake_mist > 0n
    ? Object.freeze({ kind: 'lost', mist: wager.stake_mist })
    : Object.freeze({ kind: 'even', mist: 0n })
}

export const result_xp_progress = (experience_before: number, experience_after: number) => {
  const before = experience_progress(experience_before)
  const after = experience_progress(experience_after)
  const same_level = before.level === after.level
  const before_percent = before.span > 0 ? (before.into / before.span) * 100 : 100
  const after_percent = after.span > 0 ? (after.into / after.span) * 100 : 100
  const base_percent = same_level ? before_percent : 0
  return Object.freeze({
    base_percent,
    gained_percent: Math.max(0, after_percent - base_percent),
    into: after.into,
    span: after.span,
  })
}

export const result_participant_shows_progress = (
  participant: Readonly<Pick<ResultParticipant, 'character_id'>>
): boolean => participant.character_id !== null

export const compact_xp = (value: number): string => {
  const compact = (divisor: number, suffix: string): string => {
    const amount = Math.round((value / divisor) * 10) / 10
    return `${Number.isInteger(amount) ? amount.toFixed(0) : amount.toFixed(1)}${suffix}`
  }
  if (Math.abs(value) >= 1_000_000_000) return compact(1_000_000_000, 'b')
  if (Math.abs(value) >= 1_000_000) return compact(1_000_000, 'm')
  if (Math.abs(value) >= 1_000) return compact(1_000, 'k')
  return value.toLocaleString()
}

export const format_fight_duration = (duration_ms: number): string => {
  const seconds = Math.max(0, Math.floor(duration_ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export const fight_duration = (
  started_at_ms: bigint | number | null,
  ended_at_ms: bigint | number | null
): number | null =>
  started_at_ms === null || ended_at_ms === null
    ? null
    : Math.max(0, Number(BigInt(ended_at_ms) - BigInt(started_at_ms)))

export const fight_result_complete = (result: FightResult | null): boolean => {
  if (!result || result.own_seat === null) return true
  const own = result.participants[result.own_seat]
  if (own?.forfeited) return true
  return result.settlement_confirmed
}
