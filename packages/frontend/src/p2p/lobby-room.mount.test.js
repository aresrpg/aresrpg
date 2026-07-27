// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// TR-97 — the MOUNTED speed WHITELIST: a peer whose broadcast `state` says it's mounted gets extra speed
// headroom so its legit ×1.5 roam is never mistaken for a speed-hack and dropped. Drives the REAL inbound path
// (trystero mocked, the app's own state_action/pos_action.onMessage fired) and observes acceptance in the
// presence ATOM (D770a W3b — a dropped packet never advances the peer's cell). Proof: at a speed that EXCEEDS
// the base cap but sits under the mounted cap, an unmounted peer's second packet is dropped (cell frozen) while
// a mounted peer's is kept (cell advances).

import { test, expect } from 'bun:test'

// Registers the '../chain/sdk' module mock BEFORE presence_adapter loads: first sightings fire the identity
// executor, and the stubbed (unconfigured → rejecting) get_sdk keeps it answering null instead of opening a
// REAL memoized SDK client from inside a unit test.
import '../test_helpers/expedition_sdk_mock.js'
import { presence_store } from '../world-shell/presence_adapter.js'
import {
  reset_trystero_mock,
  trystero_actions as actions,
  trystero_relay_sent,
  trystero_relay_socket,
  trystero_rooms,
  trystero_sent as sent,
} from '../test_helpers/trystero_mock.js'

const {
  broadcast_party_chat,
  broadcast_position,
  broadcast_state,
  join_lobby,
  leave_lobby,
  nudge_party_invite,
  set_local_cosmetic,
  sync_party_room,
} = await import('./lobby-room.js')
const { trystero_room_topic } = await import('./relay-signaling.js')

const fire_state = (/** @type {any} */ p) => actions.get('state').onMessage(p, { peerId: `peer-${p.id}` })
const fire_pos = (/** @type {any} */ p) => actions.get('pos').onMessage(p, { peerId: `peer-${p.id}` })
/** The peer's last ACCEPTED cell in the presence atom — a dropped position never advances it. */
const peer_cell = (/** @type {string} */ id) => presence_store.getState().peers.get(id)?.cell

test('#494: a live character switch re-keys the lobby identity', () => {
  leave_lobby()
  reset_trystero_mock()
  join_lobby('0xCHAR_A', { x: 1, y: 2 })
  broadcast_state({ address: '0xOWNER', color_1: 1, color_2: 2, color_3: 3 })
  set_local_cosmetic({ mounted: true, mount_glb: '/a.glb', veteran: true })

  join_lobby('0xCHAR_B', { x: 3, y: 4 })

  expect(presence_store.getState()).toMatchObject({
    character_id: '0xCHAR_B',
    my_cell: { x: 3, y: 4 },
    my_state: null,
    my_cosmetic: { mounted: false, mount_glb: null, veteran: false },
  })
  broadcast_state({ address: '0xOWNER', color_1: 4, color_2: 5, color_3: 6 })
  expect(sent.filter((row) => row.name === 'state').at(-1)?.payload.id).toBe('0xCHAR_B')
  leave_lobby()
})

// A jump of 1 tile between two back-to-back packets ⇒ dt floors to 0.05 s ⇒ ~20 tiles/s: OVER the base cap (15)
// but UNDER the mounted cap (15 × 1.8 = 27). So the second packet is dropped iff the peer is NOT mounted.
test('TR-97: a mounted peer survives a speed that drops an unmounted one', () => {
  leave_lobby()
  reset_trystero_mock()
  join_lobby('0xMINE', { x: 0, y: 0 })

  // UNMOUNTED peer: base cap. First packet spawns at (0,0); the ~20 tiles/s second is DROPPED (cell frozen).
  fire_state({ id: '0xUNMOUNTED', mounted: false })
  fire_pos({ id: '0xUNMOUNTED', x: 0, y: 0 })
  fire_pos({ id: '0xUNMOUNTED', x: 1, y: 0 })
  expect(peer_cell('0xUNMOUNTED')).toMatchObject({ x: 0, y: 0 }) // second dropped as a speed violation

  // MOUNTED peer: the broadcast `state.mounted` raises the cap → the SAME ~20 tiles/s is accepted (cell advances).
  fire_state({ id: '0xMOUNTED', mounted: true })
  fire_pos({ id: '0xMOUNTED', x: 0, y: 0 })
  fire_pos({ id: '0xMOUNTED', x: 1, y: 0 })
  expect(peer_cell('0xMOUNTED')).toMatchObject({ x: 1, y: 0 }) // both kept — the mount whitelist held

  leave_lobby()
})

test('TR-97: peer `state` decodes mounted / mount_glb / veteran into peer_state', async () => {
  const { get_peer_state } = await import('./lobby-room.js')
  leave_lobby()
  reset_trystero_mock()
  join_lobby('0xMINE', { x: 0, y: 0 })
  fire_state({ id: '0xRIDER', mounted: true, mount_glb: '/models/pet/suicune.glb', veteran: true })
  const st = get_peer_state('0xRIDER')
  expect(st?.mounted).toBe(true)
  expect(st?.mount_glb).toBe('/models/pet/suicune.glb')
  expect(st?.veteran).toBe(true)
  // an omitted-flags peer decodes to the safe falsy defaults (never undefined-driven renders)
  fire_state({ id: '0xPLAIN' })
  const plain = get_peer_state('0xPLAIN')
  expect(plain?.mounted).toBe(false)
  expect(plain?.mount_glb).toBe(null)
  expect(plain?.veteran).toBe(false)
  leave_lobby()
})

test('party invite nudge carries the exact invited character id', async () => {
  leave_lobby()
  reset_trystero_mock()
  join_lobby('0xMINE', { x: 0, y: 0 })
  nudge_party_invite('0xOWNER', '0xPARTY', '0xINVITED_CHARACTER', 'Leader')
  await Promise.resolve()

  expect(sent.find((row) => row.name === 'pinvite')?.payload).toEqual({
    to_address: '0xOWNER',
    party_id: '0xPARTY',
    invited_character_id: '0xINVITED_CHARACTER',
    from_name: 'Leader',
  })
  leave_lobby()
})

test('party chat has one direct action home and receiver-filters the exact party id', async () => {
  leave_lobby()
  reset_trystero_mock()
  join_lobby('0xMINE', { x: 0, y: 0 })
  sync_party_room('0xPARTY')

  broadcast_party_chat('0xMINE', 'Mine', 'hello', 'CHAT_GROUP')
  expect(sent.find((row) => row.name === 'pchat')?.payload).toMatchObject({
    party_id: '0xPARTY',
    id: '0xMINE',
    message: 'hello',
  })

  const before = presence_store.getState().chat_seq
  actions.get('pchat').onMessage({ party_id: '0xOTHER', id: '0xPEER', message: 'private', channel: 'CHAT_GROUP' })
  expect(presence_store.getState().chat_seq).toBe(before)
  actions.get('pchat').onMessage({ party_id: '0xPARTY', id: '0xPEER', message: 'party', channel: 'CHAT_GROUP' })
  expect(presence_store.getState().chat_seq).toBe(before + 1)
  sync_party_room(null)
  leave_lobby()
})

test('an established direct peer silences root relay notes while game actions stay on makeAction', async () => {
  leave_lobby()
  reset_trystero_mock()
  join_lobby('0xMINE', { x: 0, y: 0 })
  trystero_rooms[0].connectPeer('peer-direct')
  await new Promise((resolve) => setTimeout(resolve, 0))

  const root_topic = await trystero_room_topic('aresrpg-world-lobby-testnet', 'world')
  const event = (topic, payload) =>
    JSON.stringify(['EVENT', { tags: [['x', topic]], content: JSON.stringify(payload) }])

  trystero_relay_socket.send(event(root_topic, { peerId: 'bun-test-peer' }))
  expect(trystero_relay_sent).toHaveLength(0)
  trystero_relay_socket.send(event('peer-topic', { peerId: 'bun-test-peer', offer: 'encrypted' }))
  expect(trystero_relay_sent).toHaveLength(1)

  broadcast_position('0xMINE', 1, 2)
  expect(sent.at(-1)).toMatchObject({ name: 'pos', payload: { id: '0xMINE', x: 1, y: 2 } })
  expect(trystero_relay_sent).toHaveLength(1)
  leave_lobby()
})
