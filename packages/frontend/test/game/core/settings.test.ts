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
      music_enabled: true,
      follow_leader: false,
      chat_visible_channels: ['general', 'party', 'whisper', 'combat'],
      chat_speak_channel: 'general',
      auto_switch_fighter: true,
      always_craft_from_character_id: null,
      placement_gas_warning_disabled: false,
      marketplace_disclaimer_acknowledged: false,
      render_distance: null,
      fight_access: 0,
    })
  })

  test('loads and saves display and music preferences together', () => {
    const storage = memory_storage()
    save_game_settings(
      {
        quality: 'high',
        flat_mode: true,
        music_enabled: false,
        follow_leader: true,
        chat_visible_channels: ['general', 'party'],
        chat_speak_channel: 'party',
        auto_switch_fighter: false,
        always_craft_from_character_id: '0xcrafter',
        placement_gas_warning_disabled: true,
        render_distance: 8,
        fight_access: 1,
      },
      storage
    )

    expect(load_game_settings('low', null, storage)).toEqual({
      quality: 'high',
      flat_mode: true,
      music_enabled: false,
      follow_leader: true,
      chat_visible_channels: ['general', 'party'],
      chat_speak_channel: 'party',
      auto_switch_fighter: false,
      always_craft_from_character_id: '0xcrafter',
      placement_gas_warning_disabled: true,
      marketplace_disclaimer_acknowledged: false,
      render_distance: 8,
      fight_access: 1,
    })
  })

  test('a valid development override wins without erasing flat mode', () => {
    const storage = memory_storage(JSON.stringify({ quality: 'low', flat_mode: true }))

    expect(load_game_settings('medium', 'high', storage)).toEqual({
      quality: 'high',
      flat_mode: true,
      music_enabled: true,
      follow_leader: false,
      chat_visible_channels: ['general', 'party', 'whisper', 'combat'],
      chat_speak_channel: 'general',
      auto_switch_fighter: true,
      always_craft_from_character_id: null,
      placement_gas_warning_disabled: false,
      marketplace_disclaimer_acknowledged: false,
      render_distance: null,
      fight_access: 0,
    })
  })

  test('rejects malformed fight access without discarding other saved settings', () => {
    const storage = memory_storage(JSON.stringify({ flat_mode: true, fight_access: 7 }))

    expect(load_game_settings('medium', null, storage)).toMatchObject({ flat_mode: true, fight_access: 0 })
  })

  test('accepts only a concrete character identity for the crafting lock', () => {
    const valid = memory_storage(JSON.stringify({ always_craft_from_character_id: '0xcrafter' }))
    const malformed = memory_storage(JSON.stringify({ always_craft_from_character_id: true }))

    expect(load_game_settings('medium', null, valid).always_craft_from_character_id).toBe('0xcrafter')
    expect(load_game_settings('medium', null, malformed).always_craft_from_character_id).toBeNull()
  })

  test('persists marketplace disclaimer acknowledgement only from an explicit true value', () => {
    const accepted = memory_storage(JSON.stringify({ marketplace_disclaimer_acknowledged: true }))
    const malformed = memory_storage(JSON.stringify({ marketplace_disclaimer_acknowledged: 'yes' }))

    expect(load_game_settings('medium', null, accepted).marketplace_disclaimer_acknowledged).toBeTrue()
    expect(load_game_settings('medium', null, malformed).marketplace_disclaimer_acknowledged).toBeFalse()
  })

  test('rejects malformed chat preferences while preserving an intentional empty filter set', () => {
    const malformed = memory_storage(
      JSON.stringify({ chat_visible_channels: ['party', 'invalid'], chat_speak_channel: 'combat' })
    )
    const hidden = memory_storage(JSON.stringify({ chat_visible_channels: [], chat_speak_channel: 'party' }))

    expect(load_game_settings('medium', null, malformed)).toMatchObject({
      chat_visible_channels: ['general', 'party', 'whisper', 'combat'],
      chat_speak_channel: 'general',
    })
    expect(load_game_settings('medium', null, hidden)).toMatchObject({
      chat_visible_channels: [],
      chat_speak_channel: 'party',
    })
  })
})
