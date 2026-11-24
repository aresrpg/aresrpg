// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  load_game_settings,
  RENDER_DISTANCE_MIN,
  save_game_settings,
  type GameSettings,
} from '../game/core/settings.ts'
import { master_volume_from, set_master_audio_volume } from '../game/core/audio_volume.ts'
import { dispose_audio, play_audio, sync_audio_volumes } from '../game/audio/audio_registry.ts'
import { observe_interface_audio } from '../game/audio/interface_audio.ts'
import { env } from '../env.ts'
import type { AppInput, AppModule, AppState } from '../store.ts'

import { next_engine_recovery } from './engine_state.ts'

export type SettingsInput = Readonly<{ type: 'settings/changed'; settings: GameSettings }>

const reduce = (state: AppState, input: AppInput): AppState => {
  if (input.type === 'settings/changed') return Object.freeze({ ...state, settings: input.settings })
  if (input.type === 'engine/status' && next_engine_recovery(state.engine, input.status) !== state.engine.recovery)
    return Object.freeze({
      ...state,
      settings: Object.freeze({ ...state.settings, quality: 'low', render_distance: RENDER_DISTANCE_MIN }),
    })
  if (input.type !== 'server/packet' || input.packet.type !== 'packet/characters') return state
  const character_id = state.settings.always_craft_from_character_id
  if (!character_id || state.session.characters.some(({ id }) => id === character_id)) return state
  return Object.freeze({
    ...state,
    settings: Object.freeze({ ...state.settings, always_craft_from_character_id: null }),
  })
}

export const audible_settings_signature = (settings: GameSettings): string =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(settings)
        .filter(
          ([key]) => !['completed_tutorials', 'placement_gas_warning_disabled', 'journey_collapsed'].includes(key)
        )
        .sort(([a], [b]) => a.localeCompare(b))
    )
  )

const observe = ({ events, dispatch, get_state, signal }: Parameters<NonNullable<AppModule['observe']>>[0]): void => {
  signal.addEventListener('abort', dispose_audio, { once: true })
  observe_interface_audio(signal)
  let previous_settings = audible_settings_signature(get_state().settings)
  set_master_audio_volume(master_volume_from(get_state().settings.master_volume))
  events.on('settings/changed', () => {
    const { settings } = get_state()
    const next = audible_settings_signature(settings)
    set_master_audio_volume(master_volume_from(settings.master_volume))
    sync_audio_volumes()
    if (next !== previous_settings) play_audio('settings_changed')
    previous_settings = next
  })
  events.on('STATE_UPDATED', (state, previous) => {
    // The settings page shows the account's SuiNS names: opening it reads them again, leaving it drops an edit.
    const settings_page = state.navigation.page === 'settings'
    const identity_changed = state.session.wallet !== previous.session.wallet
    if (!settings_page && previous.navigation.page === 'settings') dispatch({ type: 'suins/close' })
    if (settings_page && previous.navigation.page !== 'settings' && state.session.wallet && !identity_changed)
      dispatch({ type: 'suins/refresh' })
    if (state.settings === previous.settings) return
    set_master_audio_volume(master_volume_from(state.settings.master_volume))
    sync_audio_volumes()
    previous_settings = audible_settings_signature(state.settings)
    save_game_settings(state.settings)
  })
}

/** The saved settings for this device; a local build may ask for a graphics quality in the address. */
const initial = (): Pick<AppState, 'settings'> => ({
  settings: load_game_settings(
    env.engine_quality,
    import.meta.env.DEV ? new URLSearchParams(globalThis.location.search).get('quality') : null
  ),
})

export default Object.freeze({ name: 'settings', initial, reduce, observe }) satisfies AppModule
