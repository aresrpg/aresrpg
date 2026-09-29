// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { xp_for_level } from '@aresrpg/immutable'
import type { HydratedFightCheckpoint } from '@aresrpg/fight'

import { merge_checkpoint, type FightResult } from '../modules/fight_result.ts'
import type { AppState } from '../store.ts'

import { ADVENTURE_LOOT, ADVENTURE_NAMES } from './content.ts'

export const adventure_result = (
  state: AppState,
  checkpoint: Readonly<HydratedFightCheckpoint>,
  next_level: number
): FightResult => {
  const character = state.adventure.character!
  const result = merge_checkpoint(state, character.id, checkpoint, Number(checkpoint.contract.ended_ms ?? 0n), 0n)!
  const experience_before = xp_for_level(character.level)!
  const experience_after = xp_for_level(next_level)!
  const loot =
    state.adventure.encounter === 0 && checkpoint.contract.winner === 0n
      ? ADVENTURE_LOOT.map(({ item_type, min_qty }) => ({ item_type, qty: min_qty }))
      : []
  return {
    ...result,
    settlement_confirmed: true,
    progression_synced: true,
    level_up_open: next_level > character.level,
    participants: result.participants.map((participant) =>
      participant.character_id !== character.id
        ? { ...participant, name: ADVENTURE_NAMES[participant.name] ?? participant.name }
        : {
            ...participant,
            settled: true,
            level_before: character.level,
            level_after: next_level,
            experience_before,
            experience_after,
            xp_awarded: experience_after - experience_before,
            loot,
          }
    ),
  }
}
