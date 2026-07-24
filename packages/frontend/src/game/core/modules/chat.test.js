// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// D770a W3b regression — incoming PEER chat must reach message_history THROUGH @aresrpg/world's presence atom
// (the WS-era `packet/chatMessage` shim is dead). Drives the real wire: a `chat_received` input on the presence
// store → chat.js's observe subscription → an `action/chat_message` dispatch, with from_me computed off my
// active CHARACTER (selected_character_id) — never a wallet address (#707).

import { afterEach, beforeEach, expect, test } from 'bun:test'

// Registers the '../chain/sdk' module mock BEFORE presence_adapter's static import evaluates — the identity
// executor's chain edge stays stubbed in headless tests (and never opens a real client).
import '../../../test_helpers/expedition_sdk_mock.js'
import { presence_store, presence_input } from '../../../world-shell/presence_adapter.js'
import chat, { CHANNEL } from './chat.js'

const reset = () => presence_store.getState().input({ type: 'reset' })
beforeEach(reset)
afterEach(reset)

/** Mount chat's observe with minimal doubles. Returns the array of dispatched actions. */
function mount_chat(selected_character_id = '0xme') {
  const dispatched = []
  chat().observe({
    get_state: () => ({ selected_character_id }),
    dispatch: (type, payload) => dispatched.push({ type, payload }),
  })
  return dispatched
}

test('an incoming peer chat row dispatches action/chat_message (from_me=false)', () => {
  const dispatched = mount_chat('0xme')
  presence_input({
    type: 'chat_received',
    row: { id: '0xpeer', message: 'gm', address: '0xpeer', name: 'Bob', channel: CHANNEL.general, target: '' },
  })
  expect(dispatched.at(-1)).toEqual({
    type: 'action/chat_message',
    payload: {
      id: '0xpeer',
      message: 'gm',
      address: '0xpeer',
      name: 'Bob',
      channel: CHANNEL.general,
      target: '',
      from_me: false,
    },
  })
})

test('a row whose address is my own active character folds as from_me — #707', () => {
  const dispatched = mount_chat('0xMY_CHARACTER')
  presence_input({ type: 'chat_received', row: { id: '0xMY_CHARACTER', message: 'echo', address: '0xMY_CHARACTER' } })
  expect(dispatched.at(-1)?.payload.from_me).toBe(true)
})

test('a row from a DIFFERENT character never folds as from_me, even though my own resolves true — #707', () => {
  const dispatched = mount_chat('0xMY_CHARACTER')
  presence_input({ type: 'chat_received', row: { id: '0xother', message: 'gm', address: '0xother' } })
  expect(dispatched.at(-1)?.payload.from_me).toBe(false)
})

test('a malformed row (no message) never dispatches — the core drops it', () => {
  const dispatched = mount_chat()
  presence_input({ type: 'chat_received', row: { id: '0xpeer' } })
  expect(dispatched).toHaveLength(0)
})
