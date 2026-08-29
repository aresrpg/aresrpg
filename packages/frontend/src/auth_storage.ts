// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

const AUTH_WALLET_KEY = 'last_wallet'

export type AuthStorage = Readonly<Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>>

export const browser_auth_storage = (): AuthStorage | null => {
  try {
    return globalThis.localStorage ?? null
  } catch (error) {
    console.warn('Browser auth storage is unavailable.', error)
    return null
  }
}

export const read_auth_wallet = (storage: AuthStorage | null): string | null => {
  try {
    const wallet_name = storage?.getItem(AUTH_WALLET_KEY)?.trim()
    return wallet_name ? wallet_name : null
  } catch (error) {
    console.warn('Remembered auth could not be read.', error)
    return null
  }
}

export const remember_auth_wallet = (storage: AuthStorage | null, wallet_name: string): void => {
  try {
    storage?.setItem(AUTH_WALLET_KEY, wallet_name)
  } catch (error) {
    console.warn('Auth could not be remembered; restoration remains best-effort.', error)
  }
}

export const clear_auth_wallet = (storage: AuthStorage | null): void => {
  try {
    storage?.removeItem(AUTH_WALLET_KEY)
  } catch (error) {
    console.warn('Remembered auth could not be cleared.', error)
  }
}

// ── the last-played character tab (survives reloads; a stale id falls back in the fold) ──
const SELECTED_CHARACTER_KEY = 'aresrpg.selected_character'

export const read_selected_character = (): string | null => {
  try {
    return globalThis.localStorage?.getItem(SELECTED_CHARACTER_KEY) ?? null
  } catch (error) {
    console.warn('Character-tab storage is unavailable; starting on the first character.', error)
    return null
  }
}

export const remember_selected_character = (character_id: string): void => {
  try {
    globalThis.localStorage?.setItem(SELECTED_CHARACTER_KEY, character_id)
  } catch (error) {
    console.warn('Character-tab storage is unavailable; the selection will not survive a reload.', error)
  }
}

export const remember_selected_character_change = (current: string | null, previous: string | null): void => {
  if (current && current !== previous) remember_selected_character(current)
}
