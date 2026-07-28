// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FULL-CHAIN COURIER BRIDGE REPRO — a peer that reaches the transport must become a visible player, bump the
// aggregate online count, AND land a chat line — through the REAL game.js module wiring (presence + chat
// modules observing the real context), NOT a hand-rolled context (presence.spectate.test.js bypasses game.js).
// This is the exact production path the "1 player both sides, chat never crosses" symptom lives on.

import { afterEach, beforeEach, expect, test } from 'bun:test'

// Keep chain identity reads offline: the presence edge REQUESTS an identity for every fresh peer, and this
// repro is about the transport, not the chain. Armed in beforeEach / cleared in afterEach per the helper's own
// convention — `get_sdk_implementation` is PROCESS-WIDE, so a module-scope arm would answer for every file that
// runs after this one in the same `bun test src` process (it silently rejected chain/read_templates and
// chain/live_reads, which own their own SDK expectations).
import '../test_helpers/expedition_sdk_mock.js'
import { reset_expedition_sdk_mock, set_expedition_sdk_mock } from '../test_helpers/expedition_sdk_mock.js'

beforeEach(() => set_expedition_sdk_mock(() => Promise.reject(new Error('no SDK session in headless repro'))))
afterEach(() => reset_expedition_sdk_mock())

// The REAL production graph: game.js boots the module pipeline (presence + chat observe the real context);
// presence_adapter owns the ONE presence atom; courier_inputs is the transport decoder the peer drives.
const { context } = await import('../game/core/game.js')
const { courier_inputs } = await import('../courier/world.js')
const { presence_store, presence_input } = await import('../world-shell/presence_adapter.js')
const { select_online_count } = await import('../game/core/presence_count.js')

/** One delivered courier frame, folded exactly as the world link folds it. */
const deliver = (/** @type {any} */ row) => courier_inputs(row).forEach((input) => presence_input(input))
const fire_pos = (/** @type {any} */ p) => deliver({ type: 'position', character: p.id, x: p.x, z: p.y })
const fire_chat = (/** @type {any} */ p) =>
  deliver({
    type: 'chat',
    character: p.id,
    address: p.address ?? p.id,
    text: p.message,
    channel: p.channel,
  })

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
  await settle(5) // let action/init flush so context.get_state() is the reduced state, not INITIAL_STATE

  presence_input({ type: 'session', character_id: '0xMINE' })

  // A remote peer moves through the courier stream; the presence edge requests its identity from chain.
  fire_pos({ id: '0xPEER', x: 5, y: 7 })

  // 1) presence atom holds the peer (transport → door → fold)
  expect(presence_store.getState().peers.has('0xPEER')).toBe(true)

  // 2) THE BRIDGE: the peer became a visible_character in game-core (presence.js sync projected it)
  const seen = await wait_for(() => context.get_state().visible_characters.has('0xPEER'))
  expect(seen).toBe(true)

  // 3) the aggregate online count the WorldChat header reads = peers + self
  expect(select_online_count(context.get_state())).toBe(2)

  // 4) a courier chat row reaches message_history through chat.js observe (subscribe_chat → dispatch → reduce)
  fire_chat({ id: '0xPEER', message: 'hello world', name: 'Bob', channel: 'CHAT_GENERAL' })
  const chatted = await wait_for(() => context.get_state().message_history.some((m) => m.message === 'hello world'))
  expect(chatted).toBe(true)

  presence_input({ type: 'reset' })
})
