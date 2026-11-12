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
import {
  adventure_can_fight,
  adventure_quest,
  adventure_has_ending,
  adventure_rewards_equipped,
  selected_adventurer,
} from '../adventure/quest.ts'
import { adventure_character, adventure_companion } from '../adventure/character.ts'
import { remember_demo_played, remember_adventure_choice, type AdventureChoice } from '../adventure/visit.ts'
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
  equipped_rewards: boolean
  switched_companion: boolean
  followed: boolean
  following: boolean
  dialogue: number | null
  journal_collapsed: boolean
  journal_open: boolean
  character: SimulatorCharacter | null
  encounter: number
  phase: 'explore' | 'fighting' | 'reward' | 'choice' | 'onboarding' | 'ending' | 'complete' | 'entered'
  result: FightResult | null
}>
export type AdventureInput =
  | Readonly<{ type: 'adventure/talk' | 'adventure/invite' | 'adventure/ending_finished' | 'adventure/game_entered' }>
  | Readonly<{ type: 'adventure/select'; character_id: string }>
  | Readonly<{ type: 'adventure/follow'; enabled: boolean }>
  | Readonly<{ type: 'adventure/journal'; open: boolean }>
  | Readonly<{ type: 'adventure/journal_collapsed'; collapsed: boolean }>
  | Readonly<{ type: 'adventure/entered'; choice?: AdventureChoice | null }>
  | Readonly<{ type: 'adventure/choice'; choice: AdventureChoice }>
  | Readonly<{ type: 'adventure/challenge' | 'adventure/cancelled' }>
  | Readonly<{ type: 'adventure/stats_raised'; spending: CharacteristicValues }>
  | Readonly<{ type: 'adventure/settled'; checkpoint: Readonly<HydratedFightCheckpoint> }>
  | Readonly<{ type: 'adventure/equipment_changed'; equipment: EquipmentMap }>
  | Readonly<{ type: 'adventure/result_acknowledged'; screen: 'result' | 'level' }>
export const initial_adventure_state = (): AdventureState =>
  Object.freeze({
    character: null,
    companion: null,
    selected_character_id: null,
    equipped_rewards: false,
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
  const loadout = Object.fromEntries(rows.map(([slot, item]) => [slot, item!.item_type]))
  return {
    ...state,
    equipped_rewards: state.equipped_rewards || adventure_rewards_equipped(loadout),
    [character.id === state.character?.id ? 'character' : 'companion']: {
      ...character,
      loadout,
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
  if (!result || state.phase !== 'reward' || adventure_has_ending(state)) return state
  if (screen === 'level') return { ...state, result: { ...result, level_up_open: false, level_up_acknowledged: true } }
  if (result.level_up_open) return state
  return { ...state, phase: state.encounter === 0 ? 'fighting' : 'explore', result: null }
}

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
  if (state.phase !== 'explore' || !state.equipped_rewards) return state
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

const ENTRY = {
  fight: { encounter: 0, phase: 'fighting' },
  continue: { encounter: 1, phase: 'explore' },
  play: { encounter: 1, phase: 'onboarding' },
} as const

const TRANSITIONS = {
  'adventure/entered': ({ adventure: state }, input) => {
    if (state.character) return state
    const progress = ENTRY[input.choice ?? 'fight']
    const initial = adventure_character()
    const character = { ...initial, level: Math.min(200, initial.level + progress.encounter) }
    return { ...state, ...progress, character, selected_character_id: character.id }
  },
  'adventure/choice': ({ adventure: state }, input) =>
    state.phase === 'choice' ? { ...state, phase: ENTRY[input.choice].phase, result: null } : state,
  'adventure/challenge': ({ adventure: state }) =>
    state.character && adventure_can_fight(state) ? { ...state, phase: 'fighting' } : state,
  'adventure/cancelled': ({ adventure: state }) => ({ ...state, phase: 'explore' }),
  'adventure/ending_finished': ({ adventure: state }) =>
    state.phase === 'ending' ? { ...state, phase: 'complete' } : state,
  'adventure/game_entered': ({ adventure: state, session }) =>
    ['complete', 'onboarding'].includes(state.phase) && session.wallet ? { ...state, phase: 'entered' } : state,
  'adventure/journal_collapsed': ({ adventure }, input) => ({ ...adventure, journal_collapsed: input.collapsed }),
  'adventure/journal': ({ adventure }, input) => ({ ...adventure, journal_open: input.open }),
  'adventure/stats_raised': ({ adventure }, input) => raise_stats(adventure, input.spending),
  'adventure/settled': (state, input) => settled(state, input.checkpoint),
  'adventure/equipment_changed': ({ adventure }, input) => equip(adventure, input.equipment),
  'adventure/result_acknowledged': ({ adventure }, input) => acknowledge(adventure, input.screen),
  'adventure/talk': ({ adventure }, input) => recruit(adventure, input),
  'adventure/invite': ({ adventure }, input) => recruit(adventure, input),
  'adventure/select': ({ adventure }, input) => recruit(adventure, input),
  'adventure/follow': ({ adventure }, input) => recruit(adventure, input),
} satisfies { [T in AdventureInput['type']]: (state: AppState, input: AdventureInput & { type: T }) => AdventureState }

const transition = (state: AppState, input: AdventureInput): AdventureState =>
  // The key selects the handler for this exact input variant.
  (TRANSITIONS[input.type] as (state: AppState, input: AdventureInput) => AdventureState)(state, input)

const CLOSED_PHASES: Readonly<Record<string, Readonly<Partial<Record<number, AdventureState['phase']>>>>> = {
  adventure_0: { 0: 'choice' },
  [`adventure_${ADVENTURE_ENCOUNTERS.length - 1}`]: { 0: 'ending', 1: 'complete' },
}
const close_result = (adventure: AdventureState): AdventureState => {
  const { result } = adventure
  if (adventure.phase !== 'reward' || !result) return adventure
  const phase = CLOSED_PHASES[result.fight]?.[result.winner ?? 1]
  return phase ? { ...adventure, phase } : adventure
}

const reduce = (state: AppState, input: AppInput): AppState => {
  if (input.type === 'fight/closed' && input.fight === null) {
    const adventure = close_result(state.adventure)
    return adventure === state.adventure ? state : { ...state, adventure }
  }

  if (!input.type.startsWith('adventure/')) return state
  const adventure = transition(state, input as AdventureInput)
  return adventure === state.adventure ? state : Object.freeze({ ...state, adventure: Object.freeze(adventure) })
}

const equipment_lesson_open = (adventure: AdventureState): boolean =>
  adventure.character !== null && adventure.phase === 'explore' && adventure_quest(adventure) === 'equip'
const SAVED_CHOICE: Readonly<Partial<Record<AdventureState['phase'], AdventureChoice>>> = {
  onboarding: 'play',
  complete: 'play',
  explore: 'continue',
}

const observe = ({ events, dispatch }: Parameters<NonNullable<AppModule['observe']>>[0]): void => {
  events.on('STATE_UPDATED', (state, previous) => {
    if (state.adventure.character && !previous.adventure.character) remember_demo_played()
    const { phase, encounter } = state.adventure
    const choice = SAVED_CHOICE[phase]
    if (choice && phase !== previous.adventure.phase && encounter > 0) remember_adventure_choice(choice)
    if (equipment_lesson_open(state.adventure) && !equipment_lesson_open(previous.adventure))
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
    if (state.adventure.phase !== 'fighting' || previous.adventure.phase !== 'fighting') return
    const { checkpoint } = state.fight
    if (checkpoint?.contract.ended) dispatch({ type: 'adventure/settled', checkpoint })
    else if (!state.fight.mounted && previous.fight.mounted) dispatch({ type: 'adventure/cancelled' })
  })
}

export default Object.freeze({ name: 'adventure', reduce, observe }) satisfies AppModule
