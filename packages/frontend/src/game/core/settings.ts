// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { QUALITY_OPTIONS, type EngineQuality } from '@aresrpg/engine'

import {
  CHAT_CHANNELS,
  chat_speak_channel_from,
  chat_visible_channels_from,
  type ChatChannel,
  type ChatSpeakChannel,
} from './chat_preferences.ts'
import { completed_tutorials_from, type TutorialId } from '../../tutorial/tutorial.ts'
import { DEFAULT_MASTER_VOLUME, master_volume_from } from './audio_volume.ts'

export const SETTINGS_STORAGE_KEY = 'aresrpg.settings'

// render_distance: the player's chunk radius override (null = the quality tier's default)
export const RENDER_DISTANCE_MIN = 4
export const RENDER_DISTANCE_MAX = 12

// The one derivation door lives in the engine (voxels AND the far shell share it) — re-exported
// here so frontend consumers keep their settings import.
export { effective_render_distance } from '@aresrpg/engine'

export type GameSettings = Readonly<{
  quality: EngineQuality
  flat_mode: boolean
  music_enabled: boolean
  /** Absent means full volume for settings saved before the master slider existed. */
  master_volume?: number
  /** Absent means enabled for settings saved before the toggle existed. */
  footsteps_enabled?: boolean
  completed_tutorials?: readonly TutorialId[]
  follow_leader?: boolean
  chat_visible_channels?: readonly ChatChannel[]
  chat_speak_channel?: ChatSpeakChannel
  auto_switch_fighter?: boolean
  /** Null/absent disables the Jobs-tab character lock. */
  always_craft_from_character_id?: string | null
  placement_gas_warning_disabled?: boolean
  marketplace_disclaimer_acknowledged?: boolean
  render_distance: number | null
  fight_access?: 0 | 1
}>

type SettingsStorage = Readonly<{
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}>

const browser_storage = (): SettingsStorage | null => {
  try {
    return globalThis.localStorage ?? null
  } catch (error) {
    console.warn('Browser settings storage is unavailable.', error)
    return null
  }
}

const is_quality = (value: unknown): value is EngineQuality => QUALITY_OPTIONS.includes(value as EngineQuality)

export const fight_access_from = (value: unknown): 0 | 1 => (value === 1 ? 1 : 0)
export const auto_switch_fighter_from = (value: unknown): boolean => value !== false
export const craft_character_id_from = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null

export const load_game_settings = (
  default_quality: EngineQuality,
  quality_override: string | null = null,
  storage: SettingsStorage | null = browser_storage()
): GameSettings => {
  const defaults = Object.freeze({
    quality: default_quality,
    flat_mode: false,
    music_enabled: true,
    master_volume: DEFAULT_MASTER_VOLUME,
    footsteps_enabled: true,
    completed_tutorials: Object.freeze([]) as readonly TutorialId[],
    follow_leader: false,
    chat_visible_channels: CHAT_CHANNELS,
    chat_speak_channel: 'general' as const,
    auto_switch_fighter: true,
    always_craft_from_character_id: null,
    placement_gas_warning_disabled: false,
    marketplace_disclaimer_acknowledged: false,
    render_distance: null,
    fight_access: 0 as const,
  })
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(SETTINGS_STORAGE_KEY) ?? 'null')
    const record = typeof parsed === 'object' && parsed !== null ? parsed : {}
    const quality = is_quality(quality_override)
      ? quality_override
      : is_quality(Reflect.get(record, 'quality'))
        ? Reflect.get(record, 'quality')
        : defaults.quality
    const flat_mode = Reflect.get(record, 'flat_mode')
    const music_enabled = Reflect.get(record, 'music_enabled')
    const master_volume = master_volume_from(Reflect.get(record, 'master_volume'))
    const footsteps_enabled = Reflect.get(record, 'footsteps_enabled')
    const completed_tutorials = completed_tutorials_from(Reflect.get(record, 'completed_tutorials'))
    const follow_leader = Reflect.get(record, 'follow_leader') === true
    const chat_visible_channels = chat_visible_channels_from(Reflect.get(record, 'chat_visible_channels'))
    const chat_speak_channel = chat_speak_channel_from(Reflect.get(record, 'chat_speak_channel'))
    const auto_switch_fighter = auto_switch_fighter_from(Reflect.get(record, 'auto_switch_fighter'))
    const always_craft_from_character_id = craft_character_id_from(
      Reflect.get(record, 'always_craft_from_character_id')
    )
    const placement_gas_warning_disabled = Reflect.get(record, 'placement_gas_warning_disabled') === true
    const marketplace_disclaimer_acknowledged = Reflect.get(record, 'marketplace_disclaimer_acknowledged') === true
    const stored_distance = Reflect.get(record, 'render_distance')
    const fight_access = fight_access_from(Reflect.get(record, 'fight_access'))
    const render_distance =
      typeof stored_distance === 'number' &&
      Number.isInteger(stored_distance) &&
      stored_distance >= RENDER_DISTANCE_MIN &&
      stored_distance <= RENDER_DISTANCE_MAX
        ? stored_distance
        : null
    return Object.freeze({
      quality,
      flat_mode: typeof flat_mode === 'boolean' ? flat_mode : defaults.flat_mode,
      music_enabled: typeof music_enabled === 'boolean' ? music_enabled : defaults.music_enabled,
      master_volume,
      footsteps_enabled: footsteps_enabled !== false,
      completed_tutorials,
      follow_leader,
      chat_visible_channels,
      chat_speak_channel,
      auto_switch_fighter,
      always_craft_from_character_id,
      placement_gas_warning_disabled,
      marketplace_disclaimer_acknowledged,
      render_distance,
      fight_access,
    })
  } catch (error) {
    console.warn('Saved game settings are invalid; using defaults.', error)
    return defaults
  }
}

export const save_game_settings = (
  settings: GameSettings,
  storage: SettingsStorage | null = browser_storage()
): void => {
  try {
    storage?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  } catch (error) {
    console.warn('Game settings could not be saved; they remain session-only.', error)
  }
}
