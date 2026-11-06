// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { master_volume_from } from '../game/core/audio_volume.ts'
import { SETTINGS_STORAGE_KEY } from '../game/core/settings_storage.ts'

type StorageSource = () => Readonly<Partial<Pick<Storage, 'getItem' | 'setItem'>>> | null
const browser_storage: StorageSource = () => (typeof window === 'undefined' ? null : window.localStorage)

const SOUND_KEY = 'aresrpg.landing.music_enabled'
const MUSIC_VOLUME = 0.35

export const load_enabled = (get_storage: StorageSource = browser_storage): boolean => {
  try {
    const storage = get_storage()
    return typeof storage?.getItem === 'function' ? storage.getItem(SOUND_KEY) !== 'false' : true
  } catch (error) {
    console.warn('Landing sound preference is unavailable.', error)
    return true
  }
}

export const save_enabled = (enabled: boolean, get_storage: StorageSource = browser_storage): void => {
  try {
    const storage = get_storage()
    if (typeof storage?.setItem === 'function') storage.setItem(SOUND_KEY, String(enabled))
  } catch (error) {
    console.warn('Landing sound preference remains session-only.', error)
  }
}

export const load_volume = (get_storage: StorageSource = browser_storage): number => {
  try {
    const storage = get_storage()
    if (typeof storage?.getItem !== 'function') return MUSIC_VOLUME
    const saved: unknown = JSON.parse(storage.getItem(SETTINGS_STORAGE_KEY) ?? 'null')
    const master = typeof saved === 'object' && saved !== null ? Reflect.get(saved, 'master_volume') : undefined
    return MUSIC_VOLUME * master_volume_from(master)
  } catch (error) {
    console.warn('Saved audio volume is unavailable.', error)
    return MUSIC_VOLUME
  }
}
