// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { save_game_settings, type GameSettings } from '../game/core/settings.ts'
import type { AppInput, AppModule, AppState } from '../store.ts'

export type SettingsInput = Readonly<{ type: 'settings/changed'; settings: GameSettings }>

const reduce = (state: AppState, input: AppInput): AppState => {
  if (input.type === 'settings/changed') return Object.freeze({ ...state, settings: input.settings })
  if (input.type !== 'server/packet' || input.packet.type !== 'packet/characters') return state
  const character_id = state.settings.always_craft_from_character_id
  if (!character_id || input.packet.characters.some(({ id }) => id === character_id)) return state
  return Object.freeze({
    ...state,
    settings: Object.freeze({ ...state.settings, always_craft_from_character_id: null }),
  })
}

const observe = ({ events }: Parameters<NonNullable<AppModule['observe']>>[0]): void => {
  events.on('STATE_UPDATED', (state, previous) => {
    if (state.settings !== previous.settings) save_game_settings(state.settings)
  })
}

export default Object.freeze({ name: 'settings', reduce, observe }) satisfies AppModule
