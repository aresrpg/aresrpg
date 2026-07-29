// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FULL-CHAIN TRANSPORT BRIDGE REPRO — a peer that reaches the p2p room must become a visible player, bump the
// aggregate online count, AND land a chat line. This is the exact production path the "1 player both sides,
// chat never crosses" symptom lives on, driven end to end: the real trystero action handlers → the real
// presence door → the real @aresrpg/world fold → the real presence.js and chat.js game modules.
//
// WHY A CONTEXT DOUBLE AND NOT game.js's SINGLETON: game.js folds through ONE process-global stream loop, and
// a `bun test src ./test` run shares it across 560 files. Any suite that kills or poisons that loop freezes
// `context.get_state()` for every file after it, so a bridge assertion against the singleton passes or fails
// on FILE ORDER rather than on this code (the predecessor of this file survived only by sitting early in the
// src tree). The double below runs the REAL modules through a REAL dispatch→reduce→STATE_UPDATED fold — the
// same idiom presence.spectate.test.js uses — so what is proven here is this bridge, and nothing else's mess.

import { EventEmitter } from 'events'

import { afterEach, beforeEach, expect, test } from 'bun:test'

// Keep chain identity reads offline: the presence edge REQUESTS an identity for every fresh peer, and this
// repro is about the transport, not the chain. Armed per-test because the helper is process-wide.
import '../../src/test_helpers/expedition_sdk_mock.js'
import { reset_expedition_sdk_mock, set_expedition_sdk_mock } from '../../src/test_helpers/expedition_sdk_mock.js'
import { deliver, reset_trystero_mock } from '../../src/test_helpers/trystero_mock.js'

const { presence_store, presence_input } = await import('../../src/world-shell/presence_adapter.js')
const { default: presence_module } = await import('../../src/game/core/modules/presence.js')
const { default: chat_module } = await import('../../src/game/core/modules/chat.js')
const { select_online_count } = await import('../../src/game/core/presence_count.js')
const { join_lobby, leave_lobby } = await import('../../src/p2p/lobby-room.js')

const WORLD = `0x${'a'.repeat(64)}`
const ME = '0xMINE'
const PEER = '0xPEER'

/** The real game-core fold, scoped to the two modules this bridge actually crosses: a dispatch runs both
 *  reducers in order and emits STATE_UPDATED, exactly as game.js's loop does. */
function make_context() {
  const events = new EventEmitter()
  const modules = [presence_module(), chat_module()]
  let state = { visible_characters: new Map(), message_history: [], selected_character_id: ME, sui: { characters: [] } }
  const context = {
    events,
    get_state: () => state,
    dispatch: (type, payload) => {
      state = modules.reduce((next, mod) => mod.reduce?.(next, { type, payload }) ?? next, state)
      events.emit('STATE_UPDATED', state)
    },
  }
  for (const mod of modules) mod.observe?.(context)
  return context
}

const wait_for = async (predicate, attempts = 200) => {
  for (let i = 0; i < attempts; i++) {
    if (predicate()) return true
    await new Promise((r) => setTimeout(r, 0))
  }
  return predicate()
}

beforeEach(() => {
  set_expedition_sdk_mock(() => Promise.reject(new Error('no SDK session in headless repro')))
  // The transport is a module singleton and the double's action table is process-wide: drop whatever room an
  // earlier suite left mounted BEFORE clearing the table, or the join below takes its idempotent no-op path
  // and delivers into actions that no longer exist.
  leave_lobby()
  reset_trystero_mock()
  presence_input({ type: 'reset' })
})
afterEach(() => {
  leave_lobby()
  reset_expedition_sdk_mock()
})

test('a peer through the REAL transport → game-core: visible player + online count 2 + chat line', async () => {
  const context = make_context()
  join_lobby(WORLD, ME)

  // A remote peer's pose arrives on the room's data channel; the presence edge requests its chain identity.
  deliver('pos', { id: PEER, x: 5, y: 7 })

  // 1) the presence atom holds the peer (transport → door → fold)
  expect(presence_store.getState().peers.has(PEER)).toBe(true)

  // 2) THE BRIDGE: the peer became a visible_character in game-core (presence.js projected it)
  expect(await wait_for(() => context.get_state().visible_characters.has(PEER))).toBe(true)

  // 3) the aggregate online count the WorldChat header reads = peers + self
  expect(select_online_count(context.get_state())).toBe(2)

  // 4) a peer chat line reaches message_history through chat.js observe (subscribe_chat → dispatch → reduce)
  deliver('chat', { id: PEER, message: 'hello world', name: 'Bob', channel: 'CHAT_GENERAL' })
  expect(await wait_for(() => context.get_state().message_history.some((m) => m.message === 'hello world'))).toBe(true)

  // 5) and the peer's departure clears it — membership IS presence, with no registry to contradict it.
  presence_input({ type: 'peer_leave', id: PEER })
  expect(await wait_for(() => !context.get_state().visible_characters.has(PEER))).toBe(true)
})
