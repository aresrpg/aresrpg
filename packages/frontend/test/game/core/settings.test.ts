// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { load_game_settings, save_game_settings, SETTINGS_STORAGE_KEY } from '../../../src/game/core/settings.ts'

const memory_storage = (initial: string | null = null) => {
  let value = initial
  return {
    getItem: (key: string) => (key === SETTINGS_STORAGE_KEY ? value : null),
    setItem: (key: string, next: string) => {
      if (key === SETTINGS_STORAGE_KEY) value = next
    },
  }
}

describe('game settings', () => {
  test('malformed storage falls back to the supplied quality', () => {
    expect(load_game_settings('medium', null, memory_storage('{'))).toEqual({
      quality: 'medium',
      flat_mode: false,
    })
  })

  test('loads and saves quality and flat mode together', () => {
    const storage = memory_storage()
    save_game_settings({ quality: 'high', flat_mode: true }, storage)

    expect(load_game_settings('low', null, storage)).toEqual({ quality: 'high', flat_mode: true })
  })

  test('a valid development override wins without erasing flat mode', () => {
    const storage = memory_storage(JSON.stringify({ quality: 'low', flat_mode: true }))

    expect(load_game_settings('medium', 'high', storage)).toEqual({ quality: 'high', flat_mode: true })
  })
})
