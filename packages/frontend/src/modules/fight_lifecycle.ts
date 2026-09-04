// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { FightMode, HydratedFightCheckpoint } from '@aresrpg/fight'

export const END_TURN_SUBMIT_GUARD_MS = 500

/** The chain clock has millisecond resolution; adjacent fast turns may share a timestamp. */
export const fight_turn_identity = (
  contract: Readonly<{ round: bigint | number; turn_ptr: bigint | number; turn_started_ms: bigint | number }>
): string => `${String(contract.round)}:${String(contract.turn_ptr)}:${String(contract.turn_started_ms)}`

export const same_fight_turn = (
  left: Readonly<{ round: bigint | number; turn_ptr: bigint | number; turn_started_ms: bigint | number }> | undefined,
  right: Readonly<{ round: bigint | number; turn_ptr: bigint | number; turn_started_ms: bigint | number }>
): boolean => left !== undefined && fight_turn_identity(left) === fight_turn_identity(right)

type FightLifecycle = Readonly<{
  mode: FightMode | null
  checkpoint: HydratedFightCheckpoint | null
  mounted?: boolean
  presentations: readonly unknown[]
  canonical_ended?: boolean
}>

export const fight_should_close = (fight: FightLifecycle, character_id: string | null): boolean => {
  if (fight.presentations.length > 0 || !fight.checkpoint) return false
  if (fight.mode === 'local') return fight.checkpoint.contract.ended
  if (fight.mode !== 'remote') return false
  if (fight.canonical_ended) return true
  if (fight.mounted === false) return false
  return (
    !!character_id &&
    fight.checkpoint.contract.fighters.some(
      (fighter) => fighter.kind.type === 'player' && fighter.kind.character === character_id && fighter.settled
    )
  )
}

export const terminal_remote_draft_needs_commit = (
  fight: FightLifecycle &
    Readonly<{ end_turn_queued: boolean; end_turn_submitted: boolean; transaction_pending: boolean }>
): boolean =>
  fight.mode === 'remote' &&
  fight.checkpoint?.contract.ended === true &&
  !fight.canonical_ended &&
  !fight.end_turn_queued &&
  !fight.end_turn_submitted &&
  !fight.transaction_pending
