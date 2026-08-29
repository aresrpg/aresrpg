// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import {
  chat_line_in_fight,
  chat_line_in_party,
  chat_message_from_draft,
  type ChatLine,
} from '../../src/modules/chat.ts'
import { chat_line_tokens } from '../../src/components/Chat.tsx'
import { initial_app_state, reduce_app_state } from '../../src/store.ts'

const line = (id: string, fight = '0xf'): ChatLine =>
  Object.freeze({ id, channel: 'combat' as const, fight, key: 'log_lost', values: Object.freeze({}) })

const settings = Object.freeze({
  quality: 'medium' as const,
  flat_mode: false,
  music_enabled: true,
  render_distance: null,
})

test('party lines render only for the selected character party', () => {
  const party = { id: 'p', channel: 'party' as const, party: '0xp', key: 'chat_line', values: Object.freeze({}) }
  expect(chat_line_in_party(party, '0xp')).toBeTrue()
  expect(chat_line_in_party(party, '0xother')).toBeFalse()
})

test('spoken names retain their owner address for the left-click context menu', () => {
  const tokens = chat_line_tokens(
    {
      id: 'chat',
      channel: 'general',
      key: 'chat_line',
      values: {
        name: { text: 'Aiko', cls: 'name', owner: '0xaiko', character_id: '0xcharacter' },
        message: { text: 'Hi', cls: 'says' },
      },
    },
    { chat_line: '{name}: {message}' },
    {}
  )
  expect(tokens.find(({ cls }) => cls === 'name')).toMatchObject({
    text: 'Aiko',
    owner: '0xaiko',
    character_id: '0xcharacter',
  })
})

test('party and private lines keep their channel-wide presentation', () => {
  const party = chat_line_tokens(
    {
      id: 'party',
      channel: 'party',
      party: '0xp',
      key: 'chat_party_line',
      values: { name: { text: 'Sceat', cls: 'party' }, message: { text: 'Ready', cls: 'party' } },
    },
    { chat_party_line: '(party) {name}: {message}' },
    {}
  )
  expect(party.map(({ text }) => text).join('')).toBe('(party) Sceat: Ready')
  expect(party.every(({ cls }) => cls === 'party')).toBeTrue()

  const whisper = chat_line_tokens(
    {
      id: 'whisper',
      channel: 'whisper',
      key: 'chat_line',
      values: { name: { text: 'Aiko', cls: 'whisper' }, message: { text: 'Psst', cls: 'whisper' } },
    },
    { chat_line: '{name}: {message}' },
    {}
  )
  expect(whisper.every(({ cls }) => cls === 'whisper')).toBeTrue()
})

test('rich message parts retain position and exact item interaction data', () => {
  const tokens = chat_line_tokens(
    {
      id: 'rich',
      channel: 'general',
      key: 'chat_line',
      values: {
        name: { text: 'Aiko', cls: 'name' },
        message: {
          text: '',
          parts: [
            { kind: 'position', world: 'nauvis', x: 50_010.47, z: 49_990.91 },
            { kind: 'text', text: ' ' },
            { kind: 'item', id: '0xhat', name: 'Fuwa Hat' },
          ],
        },
      },
    },
    { chat_line: '{name}: {message}' },
    {}
  )
  expect(tokens.find(({ position }) => position)).toMatchObject({
    text: '[nauvis · 10, -9]',
    position: { world: 'nauvis', x: 50_010.47, z: 49_990.91 },
  })
  expect(tokens.find(({ item }) => item)?.item).toEqual({ id: '0xhat', name: 'Fuwa Hat' })
})

test('the chat appends capped history and corrects only through the replaces door', () => {
  const base = initial_app_state(settings)
  const with_line = reduce_app_state(base, { type: 'chat/line', line: line('a') })
  expect(with_line.chat.lines.map(({ id }) => id)).toEqual(['a'])

  // the correction door rewrites in place, keeping the addressed id
  const corrected = reduce_app_state(with_line, {
    type: 'chat/line',
    line: Object.freeze({ ...line('ignored'), key: 'log_lost_reduced' }),
    replaces: 'a',
  })
  expect(corrected.chat.lines).toHaveLength(1)
  expect(corrected.chat.lines[0]).toMatchObject({ id: 'a', key: 'log_lost_reduced' })

  // a correction addressing a vanished line writes nothing
  const orphan = reduce_app_state(with_line, { type: 'chat/line', line: line('b'), replaces: 'gone' })
  expect(orphan).toBe(with_line)

  // history caps at 100
  const flooded = Array.from({ length: 130 }, (_, index) => index).reduce(
    (state, index) => reduce_app_state(state, { type: 'chat/line', line: line(`n${index}`) }),
    base
  )
  expect(flooded.chat.lines).toHaveLength(100)
  expect(flooded.chat.lines[0]!.id).toBe('n30')
})

test('combat lines render only inside their own fight', () => {
  expect(chat_line_in_fight(line('a', '0xfa'), '0xfa')).toBeTrue()
  expect(chat_line_in_fight(line('a', '0xfa'), '0xfb')).toBeFalse()
  expect(chat_line_in_fight({ ...line('legacy'), fight: undefined } as unknown as ChatLine, undefined)).toBeFalse()
  expect(
    chat_line_in_fight({ id: 'g', channel: 'general', key: 'chat_line', values: Object.freeze({}) }, '0xfb')
  ).toBeTrue()
})

test('inventory links append to the one chat draft and preserve multiple object identities', () => {
  const base = initial_app_state(settings)
  const one = reduce_app_state(base, { type: 'chat/link_item', item: { id: '0xhat', name: 'Fuwa Hat' } })
  const two = reduce_app_state(one, { type: 'chat/link_item', item: { id: '0xwool', name: 'Fuwa Wool' } })
  expect(two.chat.draft.text).toBe('[Fuwa Hat] [Fuwa Wool]')
  expect(chat_message_from_draft(two.chat.draft)).toEqual({
    text: '[Fuwa Hat] [Fuwa Wool]',
    items: [
      { id: '0xhat', name: 'Fuwa Hat' },
      { id: '0xwool', name: 'Fuwa Wool' },
    ],
  })
})
