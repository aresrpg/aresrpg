// FULL-CHAIN P2P BRIDGE REPRO — a peer that reaches the transport must become a visible player, bump the
// aggregate online count, AND land a chat line — through the REAL game.js module wiring (presence + chat
// modules observing the real context), NOT a hand-rolled context (presence.spectate.test.js bypasses game.js).
// This is the exact production path the "1 player both sides, chat never crosses" symptom lives on.

import { expect, test } from 'bun:test'

// Mocks BEFORE the real graph loads: trystero transport (so join_lobby wires makeAction handlers we can fire)
// and the chain sdk read (identity executor answers null — no live gRPC from a unit test).
import '../test_helpers/expedition_sdk_mock.js'
import { set_expedition_sdk_mock } from '../test_helpers/expedition_sdk_mock.js'
import { reset_trystero_mock, trystero_actions as actions } from '../test_helpers/trystero_mock.js'

set_expedition_sdk_mock(() => Promise.reject(new Error('no SDK session in headless repro')))

// The REAL production graph: game.js boots the module pipeline (presence + chat observe the real context);
// presence_adapter owns the ONE presence atom; lobby-room is the transport whose onMessage the peer drives.
const { context } = await import('../game/core/game.js')
const { presence_store, presence_input } = await import('../world-shell/presence_adapter.js')
const { join_lobby, leave_lobby } = await import('./lobby-room.js')
const { select_online_count } = await import('../game/core/presence_count.js')

const fire_pos = (/** @type {any} */ p) => actions.get('pos').onMessage(p, { peerId: `peer-${p.id}` })
const fire_state = (/** @type {any} */ p) => actions.get('state').onMessage(p, { peerId: `peer-${p.id}` })
const fire_chat = (/** @type {any} */ p) => actions.get('chat').onMessage(p, { peerId: `peer-${p.id}` })

const settle = async (attempts = 200) => {
  for (let i = 0; i < attempts; i++) await new Promise((r) => setTimeout(r, 0))
}
const wait_for = async (predicate, attempts = 200) => {
  for (let i = 0; i < attempts; i++) {
    if (predicate()) return true
    await new Promise((r) => setTimeout(r, 0))
  }
  return predicate()
}

test('a peer through the REAL transport → game-core: visible player + online count 2 + chat line', async () => {
  presence_input({ type: 'reset' })
  leave_lobby()
  reset_trystero_mock()
  await settle(5) // let action/init flush so context.get_state() is the reduced state, not INITIAL_STATE

  join_lobby('0xMINE', { x: 0, y: 0 })

  // A remote peer identifies + moves — exactly what lobby-room dispatches on state/pos onMessage.
  fire_state({ id: '0xPEER', address: '0xpeeraddr', color_1: 1, classe: 'senshi', name: 'Bob' })
  fire_pos({ id: '0xPEER', x: 5, y: 7 })

  // 1) presence atom holds the peer (transport → door → fold)
  expect(presence_store.getState().peers.has('0xPEER')).toBe(true)

  // 2) THE BRIDGE: the peer became a visible_character in game-core (presence.js sync projected it)
  const seen = await wait_for(() => context.get_state().visible_characters.has('0xPEER'))
  expect(seen).toBe(true)

  // 3) the aggregate online count the WorldChat header reads = peers + self
  expect(select_online_count(context.get_state())).toBe(2)

  // 4) a peer chat line reaches message_history through chat.js observe (subscribe_chat → dispatch → reduce)
  fire_chat({ id: '0xPEER', message: 'hello world', name: 'Bob', channel: 'CHAT_GENERAL' })
  const chatted = await wait_for(() => context.get_state().message_history.some((m) => m.message === 'hello world'))
  expect(chatted).toBe(true)

  leave_lobby()
  presence_input({ type: 'reset' })
})
