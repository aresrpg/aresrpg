// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2218 — CHAT HISTORY IS APPEND-ONLY; REPLACEMENT IS AN EXPLICIT INSTRUCTION.
//
// THE REGRESSION: #2151 taught the chat reducer to REPLACE a row whose id was already in history, on the premise
// that "every producer mints a fresh id". Chat ids are not per-message — they are per-SPEAKER: `chat_send.js`
// stamps every outgoing line with `selected_character_id`, and the peer path stamps the sender's character id.
// So the second line anybody typed overwrote their first, world-wide. Only the combat log was safe (fight.js
// mints `hit-N`/`cast-N` sequence ids).
//
// THE LAW SEALED HERE: the plain chat path ALWAYS appends — an id collision is normal and means nothing. A row
// is rewritten only when the dispatch SAYS SO, through `replaces: <row id>` — the one channel the #2151
// correction speaks on. Its seal (`adopted_hit_line_2151.test.js`) proves the other half: that door still works.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

// Registers the '../chain/sdk' module mock BEFORE presence_adapter's static import evaluates.
import '../../../../src/test_helpers/expedition_sdk_mock.js'
import { presence_store, presence_input } from '../../../../src/world-shell/presence_adapter.js'
import chat, { CHANNEL } from '../../../../src/game/core/modules/chat.js'

const reset = () => presence_store.getState().input({ type: 'reset' })
beforeEach(reset)
afterEach(reset)

const ME = '0xme'

/** The REAL module: its observe subscription feeds its own reducer, exactly as game.js wires it. */
const rig = (selected_character_id = ME) => {
  const module = chat()
  let state = { message_history: [], selected_character_id }
  const dispatch = (type, payload) => {
    state = module.reduce(state, { type, payload })
  }
  module.observe({ get_state: () => state, dispatch })
  return { dispatch, history: () => state.message_history }
}

/** What `chat_send.js` dispatches for MY OWN line — id is the SPEAKER, never the message. */
const say = (dispatch, message, id = ME) =>
  dispatch('action/chat_message', {
    id,
    message,
    address: id,
    name: 'canaryalice',
    channel: CHANNEL.general,
    target: '',
    from_me: true,
  })

describe('#2218 — a speaker’s lines never overwrite each other', () => {
  test('two consecutive world-chat lines from ONE speaker both persist', () => {
    const { dispatch, history } = rig()
    say(dispatch, 'first')
    say(dispatch, 'second')
    // RED at HEAD: the reducer found `id === '0xme'` already in history and REPLACED it — history held
    // ['second'] alone, and the first line the player typed was gone from the client forever.
    expect(
      history().map((row) => row.message),
      'chat history is append-only'
    ).toEqual(['first', 'second'])
  })

  test("a PEER's two lines both persist — through the real presence subscription", () => {
    const { history } = rig()
    const peer = { id: '0xpeer', address: '0xpeer', name: 'Bob', channel: CHANNEL.general, target: '' }
    presence_input({ type: 'chat_received', row: { ...peer, message: 'gm' } })
    presence_input({ type: 'chat_received', row: { ...peer, message: 'gn' } })
    expect(
      history().map((row) => row.message),
      "a peer's id is their identity, not their message's"
    ).toEqual(['gm', 'gn'])
  })

  test('an explicit `replaces` rewrites that row in place, keeping its id and its place in the stream', () => {
    const { dispatch, history } = rig()
    say(dispatch, 'first')
    say(dispatch, 'second')
    const target = history()[0].id
    dispatch('action/chat_message', {
      id: 'ignored-mint',
      message: 'corrected',
      channel: CHANNEL.combat,
      replaces: target,
    })
    expect(history(), 'a replacement is never a second row').toHaveLength(2)
    expect(history()[0].message).toBe('corrected')
    expect(history()[0].id, 'the addressed row keeps the id it was addressed by').toBe(target)
    expect(history()[0].replaces, 'the instruction is spent, never stored on the row').toBeUndefined()
    expect(history()[1].message, 'the rest of the stream is untouched').toBe('second')
  })

  test('a `replaces` naming no live row writes NOTHING — an instruction, never a producer of history', () => {
    const { dispatch, history } = rig()
    say(dispatch, 'first')
    dispatch('action/chat_message', { id: 'x', message: 'orphan', channel: CHANNEL.combat, replaces: 'no-such-row' })
    expect(history().map((row) => row.message)).toEqual(['first'])
  })
})
