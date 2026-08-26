// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { FightMode, HydratedFightCheckpoint } from '@aresrpg/fight'

export const END_TURN_SUBMIT_GUARD_MS = 500

type FightLifecycle = Readonly<{
  mode: FightMode | null
  checkpoint: HydratedFightCheckpoint | null
  presentations: readonly unknown[]
  canonical_ended?: boolean
}>

export const fight_should_close = (fight: FightLifecycle, character_id: string | null): boolean => {
  if (fight.presentations.length > 0 || !fight.checkpoint) return false
  if (fight.mode === 'local') return fight.checkpoint.contract.ended
  if (fight.mode !== 'remote') return false
  if (fight.canonical_ended) return true
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
