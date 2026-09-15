// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { chat_line_tokens, selected_chat_name } from '../../src/components/Chat.tsx'

test('chat identity follows the currently selected character tab', () => {
  const characters = Object.freeze([
    Object.freeze({ id: '0xa', name: 'Mori' }),
    Object.freeze({ id: '0xb', name: 'Bonelet' }),
  ])
  expect(selected_chat_name({ characters, selected_character_id: '0xa' }, 'me')).toBe('Mori')
  expect(selected_chat_name({ characters, selected_character_id: '0xb' }, 'me')).toBe('Bonelet')
  expect(selected_chat_name({ characters, selected_character_id: null }, 'me')).toBe('me')
})

test('retained combat spell identities resolve against the current locale', () => {
  const line = {
    id: 'cast',
    channel: 'combat' as const,
    fight: 'fight',
    key: 'cast',
    values: { spell: { text: 'spark', cls: 'spell' } },
  }
  expect(chat_line_tokens(line, { cast: '{spell}', spark: 'Étincelle' }, {})).toMatchObject([
    { text: 'Étincelle', cls: 'spell' },
  ])
  expect(chat_line_tokens(line, { cast: '{spell}', spark: '불꽃' }, {})).toMatchObject([{ text: '불꽃', cls: 'spell' }])
  expect(line.values.spell.text).toBe('spark')
})
