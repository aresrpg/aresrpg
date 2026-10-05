// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { content_catalog } from '../content/catalog.ts'
import type { AppState } from '../store.ts'
import type { FightResult } from '../modules/fight_result.ts'
import { crafting_character } from '../modules/craft_character_lock.ts'
import { encumbered_asset_ids } from '../inventory_stacks.ts'

import { JOURNEY_QUESTS, type JourneyQuest } from './model.ts'
import { journey_ingredients } from './ingredients.ts'

export const owned_quest_ids = (state: AppState): readonly string[] => {
  const encumbered = encumbered_asset_ids(state.marketplace.own_listings, state.trade.rows)
  const kiosk = crafting_character(state)?.kiosk ?? null
  const owned = new Set([
    ...state.session.inventory.filter(({ amount }) => amount > 0).map(({ item_type }) => item_type),
    ...state.session.characters.flatMap(({ equipment }) => equipment.map(({ item_type }) => item_type)),
  ])
  return JOURNEY_QUESTS.filter((quest) => {
    if (quest.kind === 'own') return owned.has(quest.item)
    if (quest.kind !== 'materials') return false
    const ingredients = journey_ingredients(quest.item, state.session.inventory, encumbered, kiosk)
    return ingredients.length > 0 && ingredients.every(({ have, need }) => have >= need)
  }).map(({ id }) => id)
}

const won_fight = (result: FightResult, owned: readonly string[]): boolean =>
  result.settlement_confirmed &&
  result.winner !== null &&
  result.participants.some(
    (participant) =>
      participant.character_id !== null &&
      owned.includes(participant.character_id) &&
      participant.team === result.winner &&
      !participant.forfeited
  )

export const won_dungeon = (result: FightResult, owned: readonly string[]): string | null => {
  const { dungeon } = result
  if (!dungeon || !won_fight(result, owned)) return null
  return dungeon.room === content_catalog.dungeon(dungeon.dungeon)?.rooms.length ? dungeon.dungeon : null
}

type FightProof = Readonly<{ key: string; kind: 'hunt' | 'dungeon'; target: string }>

const fight_proofs = (
  results: Readonly<Record<string, FightResult>>,
  owned: readonly string[]
): readonly FightProof[] =>
  Object.values(results).flatMap((result) => {
    if (!won_fight(result, owned)) return []
    const dungeon = won_dungeon(result, owned)
    return [
      ...(result.defeated_mob_types ?? []).map((target) => ({ kind: 'hunt' as const, target })),
      ...(dungeon ? [{ kind: 'dungeon' as const, target: dungeon }] : []),
    ].map((proof) => ({ ...proof, key: `${result.fight}:${proof.kind}:${proof.target}` }))
  })

export const action_quest_ids = (state: AppState, previous: AppState): readonly string[] => {
  if (
    state.world.gathering === previous.world.gathering &&
    state.fight_result.current_by_character === previous.fight_result.current_by_character &&
    state.session.craft_result === previous.session.craft_result
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
  const previous_proofs = new Set(fight_proofs(previous.fight_result.current_by_character, owned).map(({ key }) => key))
  const proofs = fight_proofs(state.fight_result.current_by_character, owned).filter(
    ({ key }) => !previous_proofs.has(key)
  )
  const craft = state.session.craft_result
  const crafts = craft && craft.digest !== previous.session.craft_result?.digest ? [craft.output_type] : []
  const actions: Partial<Record<JourneyQuest['kind'], ReadonlySet<string>>> = {
    harvest: harvests,
    dungeon: new Set(proofs.filter(({ kind }) => kind === 'dungeon').map(({ target }) => target)),
    hunt: new Set(proofs.filter(({ kind }) => kind === 'hunt').map(({ target }) => target)),
    craft: new Set(crafts),
  }
  return JOURNEY_QUESTS.filter((quest) => actions[quest.kind]?.has(quest.dungeon ?? quest.mob ?? quest.item)).map(
    ({ id }) => id
  )
}

export const quest_changes = (state: AppState, previous: AppState): readonly string[] => {
  if (!state.journey.ready || !state.journey.completed.includes('welcome') || !state.session.roster_loaded) return []
  const ownership_changed = [
    state.session.inventory !== previous.session.inventory,
    state.session.characters !== previous.session.characters,
    state.session.selected_character_id !== previous.session.selected_character_id,
    state.settings.always_craft_from_character_id !== previous.settings.always_craft_from_character_id,
    state.marketplace.own_listings !== previous.marketplace.own_listings,
    state.trade.rows !== previous.trade.rows,
    state.journey.completed !== previous.journey.completed,
  ].some(Boolean)
  const ids = [...(ownership_changed ? owned_quest_ids(state) : []), ...action_quest_ids(state, previous)]
  const satisfied = new Set([...state.journey.completed, ...ids])
  return JOURNEY_QUESTS.filter(
    (quest) =>
      ids.includes(quest.id) && !satisfied.has(quest.superseded_by ?? '') && !state.journey.completed.includes(quest.id)
  ).map(({ id }) => id)
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
