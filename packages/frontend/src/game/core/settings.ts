// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { QUALITY_OPTIONS, type EngineQuality } from '@aresrpg/engine'

export const SETTINGS_STORAGE_KEY = 'aresrpg.settings'

export type GameSettings = Readonly<{
  quality: EngineQuality
  flat_mode: boolean
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
  const defaults = Object.freeze({ quality: default_quality, flat_mode: false })
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(SETTINGS_STORAGE_KEY) ?? 'null')
    const record = typeof parsed === 'object' && parsed !== null ? parsed : {}
    const quality = is_quality(quality_override)
      ? quality_override
      : is_quality(Reflect.get(record, 'quality'))
        ? Reflect.get(record, 'quality')
        : defaults.quality
    const flat_mode = Reflect.get(record, 'flat_mode')
    return Object.freeze({ quality, flat_mode: typeof flat_mode === 'boolean' ? flat_mode : defaults.flat_mode })
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
