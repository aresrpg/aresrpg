// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// THE RESTORATION GATE — the three behaviours the p2p lane exists to deliver, each driven through the SHIPPED
// transport handlers and observed through the presence fold's own door. Nothing here reaches a network: the
// trystero strategy is mocked, and every assertion reads the reducer's projections, never module scope.
//
//   1. PRESENCE APPEARS / DISAPPEARS — a peer announcing itself becomes a visible player; a closed data channel
//      removes it, and so does silence past the freshness window (two independent removal paths, both real).
//   2. CHAT ROUND-TRIP — a line leaves on the room's own action and an inbound line reaches every chat consumer
//      exactly once, in order, through `subscribe_chat`.
//   3. THE LINK WIDGET TELLS THE TRUTH — `link_status` walks idle → connecting → connected → connecting as the
//      room actually changes, and a relay that never comes back ends at `failed` with a reason instead of
//      pretending. Under the courier this chip was frozen at "P2P idle" forever, which is the regression the
//      last assertion here exists to prevent: every state the fold can reach has a player-facing string.

import { expect, test } from 'bun:test'
import { PEER_EXPIRY_MS, REJOIN_MAX_ATTEMPTS, subscribe_chat } from '@aresrpg/world/presence'

// Mocks BEFORE the graph loads: the transport strategy, and the chain read the identity executor fires on a
// first sighting (answering null keeps a unit test off gRPC — the placeholder identity is what renders).
import '../../src/test_helpers/expedition_sdk_mock.js'
import {
  reset_trystero_mock,
  trystero_actions as actions,
  trystero_rooms,
} from '../../src/test_helpers/trystero_mock.js'

const { presence_store, presence_character, presence_input } = await import('../../src/world-shell/presence_adapter.js')
const { broadcast_chat, join_lobby, leave_lobby } = await import('../../src/p2p/lobby-room.js')

const PEER = '0xPEER'
const link_status = () => presence_store.getState().link_status
const roster = () => [...presence_store.getState().peers.keys()]

/** Drive the REAL inbound handlers the transport installed — exactly what a received data message calls. */
const fire = (name, payload) => actions.get(name).onMessage(payload, { peerId: `peer-${payload.id ?? 'x'}` })

const fresh_room = () => {
  leave_lobby()
  reset_trystero_mock()
  join_lobby('0xMINE', { x: 0, y: 0 })
  return trystero_rooms[0]
}

test('a peer APPEARS when it announces itself and DISAPPEARS when its data channel closes', () => {
  const room = fresh_room()
  expect(roster()).toEqual([])

  room.connectPeer(`peer-${PEER}`)
  fire('state', { id: PEER, address: '0xWALLET', color_1: 1, color_2: 2, color_3: 3 })
  fire('pos', { id: PEER, x: 4, y: 5 })

  expect(roster()).toEqual([PEER])
  expect(presence_character(PEER)?.address).toBe('0xWALLET')
  expect(presence_store.getState().peers.get(PEER)?.cell).toMatchObject({ x: 4, y: 5 })

  room.disconnectPeer(`peer-${PEER}`)
  expect(roster()).toEqual([])
  expect(presence_character(PEER)).toBe(null)
  leave_lobby()
})

test('a peer that goes SILENT past the freshness window folds out on the next tick', () => {
  fresh_room()
  fire('state', { id: PEER, address: '0xWALLET' })
  fire('pos', { id: PEER, x: 1, y: 1 })
  expect(roster()).toEqual([PEER])

  // The watchdog's own input, at a clock past the expiry budget. No channel close is needed: a peer whose
  // browser died without a clean leave must not linger as a ghost in anyone's roster.
  presence_input({ type: 'tick' }, Date.now() + PEER_EXPIRY_MS + 1)
  expect(roster()).toEqual([])
  leave_lobby()
})

test('CHAT ROUND-TRIP — a line leaves on the room action and an inbound line reaches consumers once, in order', async () => {
  fresh_room()
  const { trystero_sent } = await import('../../src/test_helpers/trystero_mock.js')

  broadcast_chat('0xMINE', 'Mine', 'well met', 'CHAT_GENERAL')
  expect(trystero_sent.at(-1)).toMatchObject({
    name: 'chat',
    payload: { id: '0xMINE', name: 'Mine', message: 'well met', channel: 'CHAT_GENERAL' },
  })

  const received = []
  const unsubscribe = subscribe_chat(presence_store, (row) => received.push(row))
  fire('chat', { id: PEER, name: 'Peer', message: 'and to you', channel: 'CHAT_GENERAL' })
  fire('chat', { id: PEER, name: 'Peer', message: 'shall we', channel: 'CHAT_GENERAL' })
  unsubscribe()

  expect(received.map((row) => row.message)).toEqual(['and to you', 'shall we'])
  expect(received[0]).toMatchObject({ id: PEER, address: PEER, channel: 'CHAT_GENERAL' })
  leave_lobby()
})

test('THE LINK CHIP walks the room’s real states instead of freezing at idle', () => {
  leave_lobby()
  reset_trystero_mock()
  expect(link_status()).toBe('idle') // nothing joined yet — the honest starting state

  join_lobby('0xMINE', { x: 0, y: 0 })
  expect(link_status()).toBe('connecting') // signalling: the room exists, no direct peer yet

  const [room] = trystero_rooms
  room.connectPeer(`peer-${PEER}`)
  expect(link_status()).toBe('connected') // a real RTCDataChannel is open — this is what "Direct" means

  room.disconnectPeer(`peer-${PEER}`)
  expect(link_status()).toBe('connecting') // alone again, still signalling — never a silent "connected"
  leave_lobby()
})

test('a relay that never returns ends at FAILED with a reason — no infinite silent retry', () => {
  fresh_room()
  // Each unrecovered loss spends one attempt of the finite budget; the ceiling is a terminal, EXPLAINED state.
  for (let attempt = 0; attempt <= REJOIN_MAX_ATTEMPTS; attempt += 1) presence_input({ type: 'room_lost' })

  expect(link_status()).toBe('failed')
  expect(presence_store.getState().link_error).toContain(String(REJOIN_MAX_ATTEMPTS))
  leave_lobby()
})

test('every link state the fold can reach has a player-facing string in every locale', async () => {
  const locales = ['en', 'fr', 'es', 'de', 'ja', 'uk']
  const states = ['idle', 'connecting', 'connected', 'reconnecting', 'failed']
  for (const locale of locales) {
    const { default: strings } = await import(`../../src/i18n/locales/${locale}.json`)
    for (const state of states) expect(strings.world_chat?.[`link_${state}`]).toBeTruthy()
  }
})
