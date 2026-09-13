// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { content_catalog } from '../content/catalog.ts'
import type { AppState } from '../store.ts'
import type { FightResult } from '../modules/fight_result.ts'

import { JOURNEY_QUESTS } from './model.ts'

export const owned_quest_ids = (state: AppState): readonly string[] => {
  const owned = new Set([
    ...state.session.inventory.filter(({ amount }) => amount > 0).map(({ item_type }) => item_type),
    ...state.session.characters.flatMap(({ equipment }) => equipment.map(({ item_type }) => item_type)),
  ])
  return JOURNEY_QUESTS.filter((quest) => quest.kind === 'own' && owned.has(quest.item)).map(({ id }) => id)
}

export const won_dungeon = (result: FightResult, owned: readonly string[]): string | null => {
  const { dungeon } = result
  if (!dungeon || !result.settlement_confirmed || result.winner === null) return null
  const final_room = content_catalog.dungeon(dungeon.dungeon)?.rooms.length
  const winner = result.participants.some(
    (participant) =>
      participant.character_id !== null &&
      owned.includes(participant.character_id) &&
      participant.team === result.winner &&
      !participant.forfeited
  )
  return winner && dungeon.room === final_room ? dungeon.dungeon : null
}

export const action_quest_ids = (state: AppState, previous: AppState): readonly string[] => {
  if (
    state.world.gathering === previous.world.gathering &&
    state.fight_result.current_by_character === previous.fight_result.current_by_character
  )
    return []
  const owned = state.session.characters.map(({ id }) => id)
  const harvests = new Set(
    Object.values(state.world.gathering)
      .filter((gathering) => {
        const before = previous.world.gathering[gathering.character_id]
        return (
          owned.includes(gathering.character_id) &&
          gathering.confirmed &&
          (gathering.quantity ?? 0) > 0 &&
          (before?.attempt_id !== gathering.attempt_id || !before.confirmed)
        )
      })
      .map(({ item_type }) => item_type)
  )
  const dungeons = new Set(
    Object.values(state.fight_result.current_by_character).flatMap((result) => {
      const dungeon = won_dungeon(result, owned)
      const before = Object.values(previous.fight_result.current_by_character).find(
        ({ fight }) => fight === result.fight
      )
      return dungeon && (!before || !won_dungeon(before, owned)) ? [dungeon] : []
    })
  )
  return JOURNEY_QUESTS.filter(
    (quest) =>
      (quest.kind === 'harvest' && harvests.has(quest.item)) ||
      (quest.kind === 'dungeon' && dungeons.has(quest.dungeon!))
  ).map(({ id }) => id)
}

export const quest_changes = (state: AppState, previous: AppState): readonly string[] => {
  if (!state.journey.ready || !state.journey.completed.includes('welcome') || !state.session.roster_loaded) return []
  const ownership_changed =
    state.session.inventory !== previous.session.inventory ||
    state.session.characters !== previous.session.characters ||
    state.journey.completed !== previous.journey.completed
  return [...(ownership_changed ? owned_quest_ids(state) : []), ...action_quest_ids(state, previous)].filter(
    (id) => !state.journey.completed.includes(id)
  )
}

export const journey_tracker_available = (state: AppState): boolean => {
  const character = state.session.characters.find(({ id }) => id === state.session.selected_character_id)
  return (
    state.session.wallet !== null &&
    state.session.roster_loaded &&
    state.navigation.page === 'world' &&
    !state.fight.mounted &&
    character !== undefined &&
    !character.dungeon_run
  )
}
