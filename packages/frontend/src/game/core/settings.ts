// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { QUALITY_OPTIONS, type EngineQuality } from '@aresrpg/engine'

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
  render_distance: number | null
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

export const load_game_settings = (
  default_quality: EngineQuality,
  quality_override: string | null = null,
  storage: SettingsStorage | null = browser_storage()
): GameSettings => {
  const defaults = Object.freeze({
    quality: default_quality,
    flat_mode: false,
    music_enabled: true,
    render_distance: null,
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
    const stored_distance = Reflect.get(record, 'render_distance')
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
      render_distance,
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
