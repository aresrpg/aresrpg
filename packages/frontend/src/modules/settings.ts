// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { save_game_settings, type GameSettings } from '../game/core/settings.ts'
import { master_volume_from, set_master_audio_volume } from '../game/core/audio_volume.ts'
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

const observe = ({ events, get_state }: Parameters<NonNullable<AppModule['observe']>>[0]): void => {
  set_master_audio_volume(master_volume_from(get_state().settings.master_volume))
  events.on('STATE_UPDATED', (state, previous) => {
    if (state.settings === previous.settings) return
    set_master_audio_volume(master_volume_from(state.settings.master_volume))
    save_game_settings(state.settings)
  })
}

export default Object.freeze({ name: 'settings', reduce, observe }) satisfies AppModule
