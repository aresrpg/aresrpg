// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { FightInput, FightMode, HydratedFightCheckpoint } from '@aresrpg/fight'
import type { FightActions } from '@aresrpg/sdk/auth'

import type { ActiveFightSession } from './fight_session.ts'

export const END_TURN_SUBMIT_GUARD_MS = 500

/** The chain clock has millisecond resolution; adjacent fast turns may share a timestamp. */
export const fight_turn_identity = (
  contract: Readonly<{ round: bigint | number; turn_ptr: bigint | number; turn_started_ms: bigint | number }>
): string => `${String(contract.round)}:${String(contract.turn_ptr)}:${String(contract.turn_started_ms)}`

export const same_fight_turn = (
  left: Readonly<{ round: bigint | number; turn_ptr: bigint | number; turn_started_ms: bigint | number }> | undefined,
  right: Readonly<{ round: bigint | number; turn_ptr: bigint | number; turn_started_ms: bigint | number }>
): boolean => left !== undefined && fight_turn_identity(left) === fight_turn_identity(right)

export const end_turn_submission_after_reconcile = (
  previous: Readonly<{ end_turn_submitted: boolean }>,
  same_turn: boolean,
  ended: boolean
): boolean => previous.end_turn_submitted && (same_turn || ended)

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

export const active_seat_is_dead = (checkpoint: Readonly<HydratedFightCheckpoint> | null): boolean => {
  if (!checkpoint || checkpoint.contract.round === 0n || checkpoint.contract.ended) return false
  const { fighters, queue, turn_ptr } = checkpoint.contract
  const actor = queue[Number(turn_ptr)]
  return actor !== undefined && fighters[Number(actor)]?.dead === true
}

export const terminal_remote_draft_needs_commit = (
  fight: FightLifecycle &
    Readonly<{ end_turn_queued: boolean; end_turn_submitted: boolean; transaction_pending: boolean }>
): boolean =>
  fight.mode === 'remote' &&
  (fight.checkpoint?.contract.ended === true || active_seat_is_dead(fight.checkpoint)) &&
  !fight.canonical_ended &&
  !fight.end_turn_queued &&
  !fight.end_turn_submitted &&
  !fight.transaction_pending

export const fight_turn_action = (
  input: Readonly<FightInput>
): Parameters<FightActions['commit_turn']>[0]['actions'][number] | null => {
  if (input.type === 'move_to') return Object.freeze({ type: 'move', path: Object.freeze([...input.path]) })
  if (input.type === 'cast_spell')
    return Object.freeze({
      type: 'cast',
      fighter_idx: input.fighter,
      spell: input.spell,
      target_cell: input.target_cell,
    })
  if (input.type === 'weapon_strike')
    return Object.freeze({ type: 'strike', fighter_idx: input.fighter, target_cell: input.target_cell })
  return null
}

export const local_draft_finished_turn = (
  fight: Parameters<typeof terminal_remote_draft_needs_commit>[0],
  input: Readonly<FightInput>,
  origin: 'local' | 'streamed',
  before: Readonly<ActiveFightSession> | null,
  after: Readonly<ActiveFightSession> | null
): boolean =>
  origin === 'local' &&
  fight_turn_action(input) !== null &&
  before?.checkpoint.contract.ended === false &&
  !active_seat_is_dead(before.checkpoint) &&
  after?.error === null &&
  terminal_remote_draft_needs_commit({ ...fight, mode: after.mode, checkpoint: after.checkpoint })
