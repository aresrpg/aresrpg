// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { outgoing_whisper_line } from '../../src/components/PlayerContextMenu.tsx'
import { wire_chat_line } from '../../src/modules/chat.ts'
import { chat_line_tokens, selected_chat_name, spoken_line } from '../../src/components/Chat.tsx'

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

test('remote and local chat keep handle separate from character provenance in every channel', () => {
  const text = { chat_line: '{handle}{name}: {message}', chat_party_line: '(party) {handle}{name}: {message}' }
  for (const channel of ['world', 'party', 'whisper'] as const) {
    const line = wire_chat_line({
      type: 'packet/chat_message',
      channel,
      scope: 'party',
      from: 'owner',
      character: 'Aiko',
      character_id: 'character',
      name: 'aresrpg.child.sceat.sui',
      parts: [{ kind: 'text', text: 'Hello' }],
    })!
    const tokens = chat_line_tokens(line, text, {})
    expect(tokens.map(({ text }) => text).join('')).toContain('(@child.sceat) Aiko: Hello')
    expect(tokens.find((token) => token.owner === 'owner')).toMatchObject({ text: 'Aiko', character_id: 'character' })
    expect(tokens.find((token) => token.text === '(@child.sceat) ')?.owner).toBeUndefined()
  }
  for (const channel of ['general', 'party'] as const) {
    const line = spoken_line({
      channel,
      party: 'party',
      name: 'aresrpg.child.sceat.sui',
      speaker: 'Aiko',
      character_id: 'character',
      parts: [{ kind: 'text', text: 'Hello' }],
    })
    expect(
      chat_line_tokens(line, text, {})
        .map(({ text }) => text)
        .join('')
    ).toContain('(@child.sceat) Aiko: Hello')
  }
})

test('outgoing whisper echo preserves recipient actions and separates the sender handle and character', () => {
  const line = outgoing_whisper_line(
    { address: 'recipient', name: 'Mori' },
    { id: 'character', name: 'Aiko' },
    [{ kind: 'text', text: 'Hello' }],
    'aresrpg.sceat.sui'
  )
  const tokens = chat_line_tokens(line, { chat_whisper_to: '(to {name}) {handle}{speaker}: {message}' }, {})
  expect(tokens.map(({ text }) => text).join('')).toBe('(to Mori) (@sceat) Aiko: Hello')
  expect(tokens.find((token) => token.owner === 'recipient')?.text).toBe('Mori')
  expect(tokens.find((token) => token.character_id === 'character')?.text).toBe('Aiko')
})
