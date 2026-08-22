// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { selected_chat_name } from '../../src/components/Chat.tsx'

test('chat identity follows the currently selected character tab', () => {
  const characters = Object.freeze([
    Object.freeze({ id: '0xa', name: 'Sadida' }),
    Object.freeze({ id: '0xb', name: 'Bonelet' }),
  ])
  expect(selected_chat_name({ characters, selected_character_id: '0xa' }, 'me')).toBe('Sadida')
  expect(selected_chat_name({ characters, selected_character_id: '0xb' }, 'me')).toBe('Bonelet')
  expect(selected_chat_name({ characters, selected_character_id: null }, 'me')).toBe('me')
})
