// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  characteristic_names,
  characteristic_spending_quote,
  type ClassName,
  type CharacteristicValues,
} from '@aresrpg/immutable'
import type { HydratedFightCheckpoint } from '@aresrpg/fight'

import source from '../../../../seed/content/adventure.json'
import { adventure_can_fight, adventure_has_ending, selected_adventurer } from '../adventure/quest.ts'
import { adventure_character, adventure_companion } from '../adventure/character.ts'
import { remember_demo_played } from '../adventure/visit.ts'
import { adventure_result } from '../adventure/result.ts'
import { adventure_character_row, adventure_available_inventory } from '../adventure/projection.ts'
import { equip_refusal } from '../characters/equipment_stage.ts'
import type { EquipmentMap } from '../characters/equipment_stage.ts'
import { ADVENTURE_ENCOUNTERS } from '../adventure/content.ts'
import { adventure_fight_setup } from '../adventure/fight_setup.ts'
import type { AppInput, AppModule, AppState } from '../store.ts'

import type { FightResult } from './fight_result.ts'
import type { SimulatorCharacter } from './simulator.ts'

export type AdventureState = Readonly<{
  companion: SimulatorCharacter | null
  selected_character_id: string | null
  switched_companion: boolean
  followed: boolean
  following: boolean
  dialogue: number | null
  journal_collapsed: boolean
  journal_open: boolean
  character: SimulatorCharacter | null
  encounter: number
  phase: 'explore' | 'fighting' | 'reward' | 'ending' | 'complete' | 'entered'
  result: FightResult | null
}>
export type AdventureInput =
  | Readonly<{ type: 'adventure/talk' | 'adventure/invite' | 'adventure/ending_finished' | 'adventure/game_entered' }>
  | Readonly<{ type: 'adventure/select'; character_id: string }>
  | Readonly<{ type: 'adventure/follow'; enabled: boolean }>
  | Readonly<{ type: 'adventure/journal'; open: boolean }>
  | Readonly<{ type: 'adventure/journal_collapsed'; collapsed: boolean }>
  | Readonly<{ type: 'adventure/entered' | 'adventure/challenge' | 'adventure/cancelled' }>
  | Readonly<{ type: 'adventure/stats_raised'; spending: CharacteristicValues }>
  | Readonly<{ type: 'adventure/settled'; checkpoint: Readonly<HydratedFightCheckpoint> }>
  | Readonly<{ type: 'adventure/equipment_changed'; equipment: EquipmentMap }>
  | Readonly<{ type: 'adventure/result_acknowledged'; screen: 'result' | 'level' }>
export const initial_adventure_state = (): AdventureState =>
  Object.freeze({
    character: null,
    companion: null,
    selected_character_id: null,
    switched_companion: false,
    followed: false,
    following: false,
    dialogue: null,
    journal_collapsed: false,
    journal_open: false,
    encounter: 0,
    phase: 'explore',
    result: null,
  })

const settled = (state: AppState, checkpoint: Readonly<HydratedFightCheckpoint>): AdventureState => {
  const current = state.adventure
  if (!current.character || current.phase !== 'fighting' || !checkpoint.contract.ended) return current
  const won = checkpoint.contract.winner === 0n
  const level = Math.min(200, current.character.level + Number(won))
  return {
    ...current,
    phase: 'reward',
    result: adventure_result(state, checkpoint, level),
    character: { ...current.character, level },
    encounter: Math.min(ADVENTURE_ENCOUNTERS.length - 1, current.encounter + Number(won)),
  }
}

const equip = (state: AdventureState, equipment: EquipmentMap): AdventureState => {
  const character = selected_adventurer(state)
  if (!character || state.phase === 'fighting') return state
  const rows = Object.entries(equipment).filter((entry) => entry[1] !== null)
  const valid = rows.every(
    ([slot, item]) =>
      adventure_available_inventory(state).some(({ id }) => id === item!.id) &&
      !equip_refusal({
        item: { ...item!, kiosk: 'adventure' },
        slot: slot as keyof EquipmentMap,
        character_level: character.level,
        equipment,
        listed_ids: new Set(),
      })
  )
  if (!valid) return state
  return {
    ...state,
    [character.id === state.character?.id ? 'character' : 'companion']: {
      ...character,
      loadout: Object.fromEntries(rows.map(([slot, item]) => [slot, item!.item_type])),
    },
  }
}

const raise_stats = (state: AdventureState, spending: CharacteristicValues): AdventureState => {
  const character = selected_adventurer(state)
  if (!character || state.phase === 'fighting') return state
  const quote = characteristic_spending_quote(character.classe as ClassName, character, spending)
  if (!quote || quote.cost > adventure_character_row(character).available_points) return state
  return {
    ...state,
    [character.id === state.character?.id ? 'character' : 'companion']: {
      ...character,
      ...Object.fromEntries(characteristic_names.map((stat) => [stat, character[stat] + quote.gains[stat]])),
    },
  }
}

const acknowledge = (state: AdventureState, screen: 'result' | 'level'): AdventureState => {
  const { result } = state
  if (!result || adventure_has_ending(state)) return state
  if (screen === 'level') return { ...state, result: { ...result, level_up_open: false, level_up_acknowledged: true } }
  if (result.level_up_open) return state
  return { ...state, phase: 'explore', result: null }
}

const UI_TRANSITIONS: Readonly<Record<string, (state: AppState) => AdventureState>> = Object.freeze({
  'adventure/entered': ({ adventure: state }) => {
    if (state.character) return state
    const character = adventure_character()
    return { ...state, character, selected_character_id: character.id }
  },
  'adventure/challenge': ({ adventure: state }) =>
    state.character && adventure_can_fight(state) ? { ...state, phase: 'fighting' } : state,
  'adventure/cancelled': ({ adventure: state }) => ({ ...state, phase: 'explore' }),
  'adventure/ending_finished': ({ adventure: state }) =>
    state.phase === 'ending' ? { ...state, phase: 'complete' } : state,
  'adventure/game_entered': ({ adventure: state, session }) =>
    state.phase === 'complete' && session.wallet ? { ...state, phase: 'entered' } : state,
})

const control_adventurer = (state: AdventureState, input: AdventureInput): AdventureState => {
  const { companion } = state
  if (!companion) return state
  switch (input.type) {
    case 'adventure/select': {
      if (![companion.id, state.character!.id].includes(input.character_id)) return state
      return {
        ...state,
        selected_character_id: input.character_id,
        switched_companion: state.switched_companion || input.character_id === companion.id,
      }
    }
    case 'adventure/follow':
      return state.selected_character_id === state.character!.id
        ? { ...state, following: input.enabled, followed: state.followed || input.enabled }
        : state
    default:
      return state
  }
}

const recruit = (state: AdventureState, input: AdventureInput): AdventureState => {
  if (state.phase !== 'explore' || state.encounter === 0) return state
  switch (input.type) {
    case 'adventure/talk':
      return { ...state, dialogue: Math.min(source.dialogue.length, (state.dialogue ?? -1) + 1) }
    case 'adventure/invite':
      return state.dialogue === source.dialogue.length && !state.companion
        ? { ...state, companion: adventure_companion() }
        : state
    default:
      return control_adventurer(state, input)
  }
}

const transition = (state: AppState, input: AdventureInput): AdventureState => {
  if (input.type === 'adventure/journal_collapsed') return { ...state.adventure, journal_collapsed: input.collapsed }
  if (input.type === 'adventure/journal') return { ...state.adventure, journal_open: input.open }
  const social = recruit(state.adventure, input)
  if (social !== state.adventure) return social
  const action = UI_TRANSITIONS[input.type]
  if (action) return action(state)
  switch (input.type) {
    case 'adventure/stats_raised':
      return raise_stats(state.adventure, input.spending)
    case 'adventure/settled':
      return settled(state, input.checkpoint)
    case 'adventure/equipment_changed':
      return equip(state.adventure, input.equipment)
    case 'adventure/result_acknowledged':
      return acknowledge(state.adventure, input.screen)
    default:
      return state.adventure
  }
}

const reduce = (state: AppState, input: AppInput): AppState => {
  if (
    input.type === 'fight/closed' &&
    input.fight === null &&
    state.adventure.phase === 'reward' &&
    adventure_has_ending(state.adventure)
  )
    return {
      ...state,
      adventure: { ...state.adventure, phase: state.adventure.result!.winner === 0 ? 'ending' : 'complete' },
    }

  if (!input.type.startsWith('adventure/')) return state
  const adventure = transition(state, input as AdventureInput)
  return adventure === state.adventure ? state : Object.freeze({ ...state, adventure: Object.freeze(adventure) })
}

const observe = ({ events, dispatch }: Parameters<NonNullable<AppModule['observe']>>[0]): void => {
  events.on('STATE_UPDATED', (state, previous) => {
    if (state.adventure.character && !previous.adventure.character) remember_demo_played()
    if (
      previous.adventure.result?.fight === 'adventure_0' &&
      !state.adventure.result &&
      state.adventure.encounter === 1
    )
      dispatch({ type: 'dialog/open', dialog: 'character_equipment' })
  })
  events.on('STATE_UPDATED', (state, previous) => {
    const { character, encounter, phase } = state.adventure
    if (phase === previous.adventure.phase) return
    if (phase !== 'fighting' || !character) return
    dispatch({
      type: 'fight/opened',
      mode: 'local',
      setup: adventure_fight_setup(character, encounter, state.adventure.companion),
      seed: 42n,
    })
  })
  events.on('STATE_UPDATED', (state, previous) => {
    if (state.adventure.phase !== 'fighting') return
    const { checkpoint } = state.fight
    if (checkpoint?.contract.ended) dispatch({ type: 'adventure/settled', checkpoint })
    else if (!state.fight.mounted && previous.fight.mounted) dispatch({ type: 'adventure/cancelled' })
  })
}

export default Object.freeze({ name: 'adventure', reduce, observe }) satisfies AppModule
