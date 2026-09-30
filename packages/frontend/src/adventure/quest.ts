// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import source from '../../../../seed/content/adventure.json'
import type { AdventureState } from '../modules/adventure.ts'

import { ADVENTURE_ENCOUNTERS } from './content.ts'

export type AdventureQuest = 'goblins' | 'speak' | 'invite' | 'switch' | 'follow' | 'guards' | 'boss'
export const ADVENTURE_QUESTS = source.quests as readonly AdventureQuest[]

/** Progress is derived from the local adventure facts, never a second quest-save record. */
export const adventure_quest = (state: AdventureState): AdventureQuest => {
  if (state.encounter === 0) return 'goblins'
  if (!state.companion) return state.dialogue === source.dialogue.length ? 'invite' : 'speak'
  if (!state.switched_companion) return 'switch'
  if (!state.followed) return 'follow'
  return state.encounter === 1 ? 'guards' : 'boss'
}

export const adventure_objective = (state: AdventureState) => {
  const quest = adventure_quest(state)
  const encounter = ({ goblins: 0, guards: 1, boss: 2 } as Partial<Record<AdventureQuest, number>>)[quest]
  return {
    quest,
    position: encounter === undefined ? source.companion.position : ADVENTURE_ENCOUNTERS[encounter]!.position,
  }
}

export const adventure_can_fight = (state: AdventureState): boolean =>
  ['goblins', 'guards', 'boss'].includes(adventure_quest(state))
export const selected_adventurer = (state: AdventureState) =>
  state.companion?.id === state.selected_character_id ? state.companion : state.character
export const adventure_roster = (state: AdventureState) =>
  [state.character, state.companion].filter((character) => character !== null)

export const adventure_has_ending = (state: Readonly<AdventureState>): boolean =>
  state.result?.fight === `adventure_${ADVENTURE_ENCOUNTERS.length - 1}`

export const adventure_completed_quests = (state: Readonly<AdventureState>): readonly AdventureQuest[] =>
  state.character === null
    ? []
    : ADVENTURE_QUESTS.slice(
        0,
        state.phase === 'complete' ? ADVENTURE_QUESTS.length : ADVENTURE_QUESTS.indexOf(adventure_quest(state))
      )
