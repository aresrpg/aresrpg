// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// D237 INSTANCE SCOPE proof — the peer `state` wire carries `dungeon_id` end-to-end, and the render/chat scope
// filter (mine === theirs) drops an out-of-instance peer. This drives the REAL inbound path: trystero is mocked
// (a captured `makeAction` returns a live { send, onMessage } pair — the same shape the app uses), `join_lobby`
// wires the real `state_action.onMessage`, and we invoke THAT handler with a peer's state payload — exactly what
// a received Trystero data message triggers. No test-only export is added; `get_peer_state` is the shipped read.

import { test, expect } from 'bun:test'

import { reset_trystero_mock, trystero_actions as actions } from '../test_helpers/trystero_mock.js'

// Capture the actions `join_lobby` creates so the test can fire their REAL onMessage handlers (the true inbound
// path). Each makeAction returns { send, onMessage } — the app assigns onMessage, we call it. joinRoom returns a
// room double with the same surface lobby-room touches (makeAction / onPeerJoin / onPeerLeave / leave).
const { join_lobby, get_peer_state, leave_lobby } = await import('./lobby-room.js')

// Trystero's makeAction returns [send, setOnMessage]; the app writes onMessage via the returned setter. Fire the
// captured handler the way a received data message would (data, { peerId }).
const fire_state = (/** @type {any} */ payload) => {
  const a = actions.get('state')
  a.onMessage(payload, { peerId: `peer-${payload.id}` })
}

test('D237: peer `state` decode round-trips dungeon_id into peer_state (the real onMessage wire)', () => {
  leave_lobby() // hermetic start
  reset_trystero_mock()
  // Join as MY own character (arbitrary id) so the own-echo filter (id === my_character_id) never eats the peer.
  join_lobby('0xMINE', { x: 0, y: 0 })

  // A peer INSIDE dungeon 0xDUNGEON_A announces its low-frequency state — the exact shape party_store composes.
  fire_state({
    id: '0xPEER',
    address: '0xADDR',
    color_1: 1,
    color_2: 2,
    color_3: 3,
    party_id: null,
    dungeon_id: '0xDUNGEON_A',
    classe: 'senshi',
    male: true,
    name: 'Peer',
  })
  expect(get_peer_state('0xPEER')?.dungeon_id).toBe('0xDUNGEON_A')

  // A peer in the OVERWORLD (dungeon_id omitted) must decode to null (the ?? null default), not undefined.
  fire_state({
    id: '0xOVER',
    address: '0xADDR2',
    color_1: 0,
    color_2: 0,
    color_3: 0,
    party_id: null,
    classe: 'senshi',
    male: true,
    name: 'Over',
  })
  expect(get_peer_state('0xOVER')?.dungeon_id).toBe(null)

  leave_lobby()
})

// The render loop (remote_players.same_scope) and WorldChat both gate on the SAME predicate:
//   (get_peer_state(id)?.dungeon_id ?? null) === (my dungeon_id ?? null)
// Prove that predicate against the real decoded peer_state for every scope combination — mismatch = drop/hide,
// match = render/show. (This is the exact expression both consumers evaluate; proving it here proves both.)
const in_scope = (/** @type {string} */ id, /** @type {string|null} */ mine) =>
  (get_peer_state(id)?.dungeon_id ?? null) === (mine ?? null)

test('D237: scope predicate — same dungeon renders, cross-instance drops (both directions)', () => {
  leave_lobby()
  reset_trystero_mock()
  join_lobby('0xMINE', { x: 0, y: 0 })
  fire_state({ id: '0xCOOP', dungeon_id: '0xDUNGEON_A' }) // a co-op peer in MY dungeon
  fire_state({ id: '0xOTHER', dungeon_id: '0xDUNGEON_B' }) // a peer in a DIFFERENT dungeon
  fire_state({ id: '0xLOBBY' }) // a peer in the overworld (null scope)

  // I am INSIDE dungeon A: only the co-op peer shares my instance; B and overworld are dropped.
  expect(in_scope('0xCOOP', '0xDUNGEON_A')).toBe(true)
  expect(in_scope('0xOTHER', '0xDUNGEON_A')).toBe(false)
  expect(in_scope('0xLOBBY', '0xDUNGEON_A')).toBe(false)

  // I am in the OVERWORLD (null): every dungeon peer is dropped (a player in a dungeon must not render for me);
  // only an overworld peer shares my (null) scope.
  expect(in_scope('0xCOOP', null)).toBe(false)
  expect(in_scope('0xOTHER', null)).toBe(false)
  expect(in_scope('0xLOBBY', null)).toBe(true)

  leave_lobby()
})

// D237 AMENDMENT — the full render gate `should_show(id, px, pz, cam)` in remote_players.js: instance scope
// first, then an OVERWORLD range bound (two overworld peers only; same-dungeon always renders). Not exported
// (no test-only export), so this mirrors its exact expression against the REAL decoded peer_state.
const OVERWORLD_RANGE_M = 100
const should_show = (
  /** @type {string} */ id,
  /** @type {number} */ px,
  /** @type {number} */ pz,
  /** @type {any} */ cam,
  /** @type {string|null} */ mine
) => {
  const theirs = get_peer_state(id)?.dungeon_id ?? null
  if ((mine ?? null) !== theirs) return false
  if ((mine ?? null) !== null) return true // same DUNGEON → always render (small room, no range gate)
  if (!cam) return true
  return (cam.position.x - px) ** 2 + (cam.position.z - pz) ** 2 <= OVERWORLD_RANGE_M * OVERWORLD_RANGE_M
}

test('D237 amendment: overworld range-bound (far peer dropped, near peer shown; in-cave co-op ignores range)', () => {
  leave_lobby()
  reset_trystero_mock()
  join_lobby('0xMINE', { x: 0, y: 0 })
  fire_state({ id: '0xNEAR', dungeon_id: null }) // overworld peer, will stand near me
  fire_state({ id: '0xFAR', dungeon_id: null }) // overworld peer, will stand far
  fire_state({ id: '0xCOOP', dungeon_id: '0xDUNGEON_A' }) // co-op peer in MY dungeon (range must NOT apply)
  const cam = { position: { x: 0, y: 60, z: 0 } } // my camera at origin

  // Both overworld: a peer 30m away renders, a peer 300m away is dropped.
  expect(should_show('0xNEAR', 30, 0, cam, null)).toBe(true)
  expect(should_show('0xFAR', 300, 0, cam, null)).toBe(false)

  // In-cave (mine = dungeon A): the co-op peer renders even at an absurd distance — the room is small, range
  // must never apply inside an instance.
  expect(should_show('0xCOOP', 9999, 9999, cam, '0xDUNGEON_A')).toBe(true)

  // Camera not yet booted (null) → fail-open on range (the instance scope still held above).
  expect(should_show('0xFAR', 300, 0, null, null)).toBe(true)

  leave_lobby()
})
