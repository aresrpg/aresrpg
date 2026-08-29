// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One nullable device preference constrains Jobs-page selection. Session remains the sole owner
// of selected_character_id; this module only derives the permitted selection for its reducer.

import type { CharacterRow } from '@aresrpg/protocol'

import type { AppInput, AppState } from '../store.ts'

import { is_jobs_pathname } from './navigation.ts'
import type { SessionState } from './session.ts'

const configured_character_id = (
  state: Readonly<AppState>,
  pathname: string,
  characters: readonly Readonly<Pick<CharacterRow, 'id'>>[]
): string | null => {
  const character_id = state.settings.always_craft_from_character_id
  if (!is_jobs_pathname(pathname) || !character_id) return null
  return characters.some(({ id }) => id === character_id) ? character_id : null
}

const with_selected_character = (state: AppState, character_id: string): AppState =>
  state.session.selected_character_id === character_id
    ? state
    : Object.freeze({
        ...state,
        session: Object.freeze({ ...state.session, selected_character_id: character_id }),
      })

export const with_craft_character_session = (state: AppState, session: SessionState): AppState => {
  const character_id = configured_character_id(state, state.navigation.pathname, session.characters)
  const selected_session =
    character_id && session.selected_character_id !== character_id
      ? Object.freeze({ ...session, selected_character_id: character_id })
      : session
  return Object.freeze({ ...state, session: selected_session })
}

export const reduce_craft_character_selection = (state: AppState, input: AppInput): AppState | null => {
  if (input.type === 'path/open' || input.type === 'route/changed') {
    const character_id = configured_character_id(state, input.pathname, state.session.characters)
    return character_id ? with_selected_character(state, character_id) : state
  }
  if (input.type !== 'character/select') return null
  const locked = configured_character_id(state, state.navigation.pathname, state.session.characters)
  const character_id = locked ?? input.character_id
  return state.session.characters.some(({ id }) => id === character_id)
    ? with_selected_character(state, character_id)
    : state
}
