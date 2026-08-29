// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import {
  CHAT_CHANNELS,
  chat_speak_channel_from,
  chat_visible_channels_from,
  effective_chat_speak_channel,
  toggled_chat_speak_channel,
  toggle_chat_channel,
} from '../../../src/game/core/chat_preferences.ts'

test('chat preferences normalize storage and preserve an intentional empty filter set', () => {
  expect(chat_visible_channels_from(undefined)).toBe(CHAT_CHANNELS)
  expect(chat_visible_channels_from(['party', 'general', 'party'])).toEqual(['general', 'party'])
  expect(chat_visible_channels_from([])).toEqual([])
  expect(chat_visible_channels_from(['party', 'bogus'])).toBe(CHAT_CHANNELS)
  expect(chat_speak_channel_from('party')).toBe('party')
  expect(chat_speak_channel_from('combat')).toBe('general')
  expect(effective_chat_speak_channel('party', false)).toBe('general')
  expect(effective_chat_speak_channel('party', true)).toBe('party')
  expect(toggled_chat_speak_channel('general')).toBe('party')
})

test('channel toggles retain canonical order and can hide every channel', () => {
  const without_party = toggle_chat_channel(CHAT_CHANNELS, 'party')
  expect(without_party).toEqual(['general', 'whisper', 'combat'])
  expect(toggle_chat_channel(without_party, 'party')).toEqual(CHAT_CHANNELS)
  expect(CHAT_CHANNELS.reduce(toggle_chat_channel, CHAT_CHANNELS)).toEqual([])
})
