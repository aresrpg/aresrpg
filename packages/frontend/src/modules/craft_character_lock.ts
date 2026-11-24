// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One preference resolves every live craft. The jobs window also constrains roster selection.

import type { CharacterRow } from '@aresrpg/protocol'

import type { AppInput, AppModule, AppState } from '../store.ts'

const configured_character_id = (
  state: Readonly<AppState>,
  characters: readonly Readonly<Pick<CharacterRow, 'id'>>[]
): string | null => {
  const character_id = state.settings.always_craft_from_character_id
  if (!character_id) return null
  return characters.some(({ id }) => id === character_id) ? character_id : null
}

export const crafting_character = (
  state: Readonly<AppState>,
  fallback?: Readonly<CharacterRow>
): CharacterRow | undefined => {
  const id =
    configured_character_id(state, state.session.characters) ?? fallback?.id ?? state.session.selected_character_id
  return state.session.characters.find((character) => character.id === id) ?? fallback
}

export const jobs_open = (state: Readonly<AppState>): boolean => state.navigation.dialog === 'character_jobs'

export const crafting_lock_id = (state: Readonly<AppState>): string | null =>
  jobs_open(state) ? configured_character_id(state, state.session.characters) : null

const with_selected_character = (state: AppState, character_id: string): AppState =>
  state.session.selected_character_id === character_id
    ? state
    : Object.freeze({
        ...state,
        session: Object.freeze({ ...state.session, selected_character_id: character_id }),
      })

/** Whether an input opens the jobs window. */
const opens_jobs = (input: AppInput): boolean => input.type === 'dialog/open' && input.dialog === 'character_jobs'

/** The crafting character an input locks the played character on, once the session has folded it. */
const locked_after = (state: AppState, input: AppInput): string | null => {
  if (opens_jobs(input)) return configured_character_id(state, state.session.characters)
  return input.type === 'character/select' || input.type === 'server/packet' ? crafting_lock_id(state) : null
}

const reduce = (state: AppState, input: AppInput): AppState => {
  const character_id = locked_after(state, input)
  return character_id ? with_selected_character(state, character_id) : state
}

export default Object.freeze({ name: 'craft_lock', reduce }) satisfies AppModule
