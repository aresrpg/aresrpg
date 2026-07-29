// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// D237 INSTANCE SCOPE proof — the peer `state` wire carries `dungeon_id` end-to-end, and the render/chat scope
// filter (mine === theirs) drops an out-of-instance peer. This drives the REAL inbound path: trystero is mocked
// (a captured `makeAction` returns a live { send, onMessage } pair — the same shape the app uses), `join_lobby`
// wires the real `state_action.onMessage`, and we invoke THAT handler with a peer's state payload — exactly what
// a received Trystero data message triggers. No test-only export is added; `presence_character` is the shipped read.

import { test, expect } from 'bun:test'

import { reset_trystero_mock, trystero_actions as actions } from '../test_helpers/trystero_mock.js'
import { same_render_instance } from '../game/remote_visibility_scope.js'

// Capture the actions `join_lobby` creates so the test can fire their REAL onMessage handlers (the true inbound
// path). Each makeAction returns { send, onMessage } — the app assigns onMessage, we call it. joinRoom returns a
// room double with the same surface lobby-room touches (makeAction / onPeerJoin / onPeerLeave / leave).
const { join_lobby, leave_lobby } = await import('./lobby-room.js')
const { presence_character: get_peer_state } = await import('../world-shell/presence_adapter.js')

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

// #333 CORRECTED — the render loop (remote_players.js should_show) gates instance scope on same_render_instance
// (remote_visibility_scope.js), imported here rather than re-derived so this test can never drift from the
// shipped behavior the way the old dungeon_id-only mirror did (that mirror "proved" the exact comparison that
// was the bug: a personal run_pass_id can never equal another player's, so two co-op partners in the SAME
// dungeon never rendered for each other). WorldChat no longer gates on dungeon_id at all (#306, PR #330) — chat
// has zero fight/dungeon awareness, so this predicate now belongs to the render loop alone.
const in_scope = (
  /** @type {string} */ id,
  /** @type {string|null} */ mine,
  /** @type {string|null} */ mine_party = null
) =>
  same_render_instance({
    mine_dungeon_id: mine ?? null,
    peer_dungeon_id: get_peer_state(id)?.dungeon_id ?? null,
    mine_party_id: mine_party ?? null,
    peer_party_id: get_peer_state(id)?.party_id ?? null,
  })

test('D237 (#333): same PARTY in the same dungeon renders despite different personal run ids; cross-instance and cross-party drop', () => {
  leave_lobby()
  reset_trystero_mock()
  join_lobby('0xMINE', { x: 0, y: 0 })
  fire_state({ id: '0xCOOP', dungeon_id: '0xDUNGEON_A_PEER_RUN', party_id: '0xPARTY' }) // co-op partner — a
  //   DIFFERENT personal run pass id than mine, same accepted party (the exact #333 repro shape)
  fire_state({ id: '0xSTRANGER', dungeon_id: '0xDUNGEON_A_STRANGER_RUN', party_id: null }) // same TEMPLATE room, no party
  fire_state({ id: '0xOTHER', dungeon_id: '0xDUNGEON_B', party_id: '0xPARTY_B' }) // a different dungeon entirely
  fire_state({ id: '0xLOBBY' }) // a peer in the overworld (null scope)

  // I am INSIDE dungeon A, in party 0xPARTY: only my co-op partner shares my instance. A stranger standing in
  // the exact same physical room (same template, same overlapping local coords) but NOT in my party, a peer in a
  // different dungeon, and an overworld peer are all dropped (D237's original invariant, preserved).
  expect(in_scope('0xCOOP', '0xDUNGEON_A_MY_RUN', '0xPARTY')).toBe(true)
  expect(in_scope('0xSTRANGER', '0xDUNGEON_A_MY_RUN', '0xPARTY')).toBe(false)
  expect(in_scope('0xOTHER', '0xDUNGEON_A_MY_RUN', '0xPARTY')).toBe(false)
  expect(in_scope('0xLOBBY', '0xDUNGEON_A_MY_RUN', '0xPARTY')).toBe(false)

  // I am in the OVERWORLD (null dungeon): every dungeon peer is dropped; only an overworld peer shares my scope.
  expect(in_scope('0xCOOP', null, null)).toBe(false)
  expect(in_scope('0xOTHER', null, null)).toBe(false)
  expect(in_scope('0xLOBBY', null, null)).toBe(true)

  leave_lobby()
})

// D237 AMENDMENT — the full render gate `should_show(id, px, pz, cam)` in remote_players.js: instance scope
// (same_render_instance, imported — never re-derived) first, then an OVERWORLD range bound (two overworld peers
// only; same-instance co-op always renders). Not exported (no test-only export on remote_players.js itself), so
// only the thin range-check wrapper is mirrored here — the instance-scope decision rides the shipped predicate.
const OVERWORLD_RANGE_M = 100
const should_show = (
  /** @type {string} */ id,
  /** @type {number} */ px,
  /** @type {number} */ pz,
  /** @type {any} */ cam,
  /** @type {string|null} */ mine,
  /** @type {string|null} */ mine_party = null
) => {
  const peer = get_peer_state(id)
  const scope = {
    mine_dungeon_id: mine ?? null,
    peer_dungeon_id: peer?.dungeon_id ?? null,
    mine_party_id: mine_party ?? null,
    peer_party_id: peer?.party_id ?? null,
  }
  if (!same_render_instance(scope)) return false
  if (scope.mine_dungeon_id !== null) return true // same DUNGEON → always render (small room, no range gate)
  if (!cam) return true
  return (cam.position.x - px) ** 2 + (cam.position.z - pz) ** 2 <= OVERWORLD_RANGE_M * OVERWORLD_RANGE_M
}

test('D237 amendment: overworld range-bound (far peer dropped, near peer shown; in-cave co-op ignores range)', () => {
  leave_lobby()
  reset_trystero_mock()
  join_lobby('0xMINE', { x: 0, y: 0 })
  fire_state({ id: '0xNEAR', dungeon_id: null }) // overworld peer, will stand near me
  fire_state({ id: '0xFAR', dungeon_id: null }) // overworld peer, will stand far
  fire_state({ id: '0xCOOP', dungeon_id: '0xDUNGEON_A_PEER_RUN', party_id: '0xPARTY' }) // co-op peer, MY party, MY dungeon (range must NOT apply)
  const cam = { position: { x: 0, y: 60, z: 0 } } // my camera at origin

  // Both overworld: a peer 30m away renders, a peer 300m away is dropped.
  expect(should_show('0xNEAR', 30, 0, cam, null)).toBe(true)
  expect(should_show('0xFAR', 300, 0, cam, null)).toBe(false)

  // In-cave (mine = dungeon A, party 0xPARTY): the co-op peer renders even at an absurd distance — the room is
  // small, range must never apply inside an instance.
  expect(should_show('0xCOOP', 9999, 9999, cam, '0xDUNGEON_A_MY_RUN', '0xPARTY')).toBe(true)

  // Camera not yet booted (null) → fail-open on range (the instance scope still held above).
  expect(should_show('0xFAR', 300, 0, null, null)).toBe(true)

  leave_lobby()
})
