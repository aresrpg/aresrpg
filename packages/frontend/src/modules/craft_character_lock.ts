// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One preference resolves every live craft. Jobs windows also constrain roster selection.

import type { CharacterRow } from '@aresrpg/protocol'

import type { AppInput, AppState } from '../store.ts'

import { is_jobs_pathname } from './navigation.ts'
import type { SessionState } from './session.ts'

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

export const jobs_open = (state: Readonly<AppState>, pathname = state.navigation.pathname): boolean =>
  is_jobs_pathname(pathname) || state.navigation.dialog === 'character_jobs'

export const crafting_lock_id = (state: Readonly<AppState>): string | null =>
  jobs_open(state) ? configured_character_id(state, state.session.characters) : null

const with_selected_character = (state: AppState, character_id: string): AppState =>
  state.session.selected_character_id === character_id
    ? state
    : Object.freeze({
        ...state,
        session: Object.freeze({ ...state.session, selected_character_id: character_id }),
      })

export const with_craft_character_session = (state: AppState, session: SessionState): AppState => {
  const character_id = jobs_open(state) ? configured_character_id(state, session.characters) : null
  const selected_session =
    character_id && session.selected_character_id !== character_id
      ? Object.freeze({ ...session, selected_character_id: character_id })
      : session
  return Object.freeze({ ...state, session: selected_session })
}

export const reduce_craft_character_selection = (state: AppState, input: AppInput): AppState | null => {
  if (input.type === 'path/open' || input.type === 'route/changed') {
    const character_id = jobs_open(state, input.pathname)
      ? configured_character_id(state, state.session.characters)
      : null
    return character_id ? with_selected_character(state, character_id) : state
  }
  if (input.type === 'dialog/open' && input.dialog === 'character_jobs') {
    const id = configured_character_id(state, state.session.characters)
    return id ? with_selected_character(state, id) : state
  }
  if (input.type !== 'character/select') return null
  const locked = crafting_lock_id(state)
  const character_id = locked ?? input.character_id
  return state.session.characters.some(({ id }) => id === character_id)
    ? with_selected_character(state, character_id)
    : state
}
