// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import source from '../../../../seed/content/adventure.json'
import type { AdventureState } from '../modules/adventure.ts'

import { ADVENTURE_ENCOUNTERS, ADVENTURE_LOOT } from './content.ts'

export type AdventureQuest = 'goblins' | 'equip' | 'speak' | 'invite' | 'switch' | 'follow' | 'guards' | 'boss'
export const ADVENTURE_QUESTS = source.quests as readonly AdventureQuest[]

/** Progress is derived from the local adventure facts, never a second quest-save record. */
export const adventure_quest = (state: AdventureState): AdventureQuest => {
  if (state.encounter === 0) return 'goblins'
  if (!state.equipped_rewards) return 'equip'
  if (!state.companion) return state.dialogue === source.dialogue.length ? 'invite' : 'speak'
  if (!state.switched_companion) return 'switch'
  if (!state.followed) return 'follow'
  return state.encounter === 1 ? 'guards' : 'boss'
}

export const adventure_objective = (state: AdventureState, label: (quest: AdventureQuest) => string) => {
  const quest = adventure_quest(state)
  if (quest === 'equip') return undefined
  const encounter = ({ goblins: 0, guards: 1, boss: 2 } as Partial<Record<AdventureQuest, number>>)[quest]
  const position = encounter === undefined ? source.companion.position : ADVENTURE_ENCOUNTERS[encounter]!.position
  return { ...position, label: label(quest) }
}

export const adventure_can_fight = (state: AdventureState): boolean =>
  state.phase === 'explore' && ['goblins', 'guards', 'boss'].includes(adventure_quest(state))
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
        ['complete', 'entered'].includes(state.phase)
          ? ADVENTURE_QUESTS.length
          : ADVENTURE_QUESTS.indexOf(adventure_quest(state))
      )

/** The ordinary equipment confirmation commits the complete reward loadout once. */
export const adventure_rewards_equipped = (loadout: Readonly<Record<string, string>>): boolean =>
  ADVENTURE_LOOT.every(({ item_type }) => Object.values(loadout).includes(item_type))
