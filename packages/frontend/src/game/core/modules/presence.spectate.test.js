// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Feature #19 (read-only SPECTATE) proof, D770a W3b — the presence BRIDGE (game/core/modules/presence.js) must
// render a remote avatar from a peer's presence ALONE, with ZERO own-roster / own-session state (a logged-out
// spectator has no characters, no wallet, no selected id). The peer truth now lives in @aresrpg/world's presence
// atom: this drives it exactly like the room transport does for a position row (`peer_pos`),
// with an EMPTY roster, and asserts the bridge built a visible-character entry. The chain-direct enrichment read
// (get_sdk → read_character, run by the adapter's identity executor) is mocked to REJECT — a logged-out spectator
// has no SDK session — proving the placeholder survives on the payload-only fallback (name/class default), no crash.

import { EventEmitter } from 'events'

import { afterEach, beforeEach, expect, test } from 'bun:test'

import {
  reset_expedition_sdk_mock,
  set_expedition_sdk_mock,
} from '../../../test_helpers/expedition_sdk_mock.js'

// The only heavy dependency in the presence graph — the chain-direct SDK read that enriches a peer's identity
// (the adapter's identity executor). Mock get_sdk to REJECT so the import stays hermetic and we prove the
// placeholder fallback holds.
const get_sdk = () => Promise.reject(new Error('no SDK session in spectate'))
set_expedition_sdk_mock(get_sdk)

const { default: presence } = await import('./presence.js')
const { presence_store, presence_input } = await import('../../../world-shell/presence_adapter.js')

// A fresh atom per test (the presence store is a process-global singleton) + the rejecting SDK mock re-armed.
beforeEach(() => {
  set_expedition_sdk_mock(get_sdk)
  presence_store.getState().input({ type: 'reset' })
})
afterEach(reset_expedition_sdk_mock)

/** Minimal game-context double: a real EventEmitter + a store with an EMPTY roster (the spectator has none).
 *  BRIDGE-A: presence.js's observe() is now a thin edge that only DISPATCHES (D770a gone) — dispatch must
 *  actually thread through a reducer for the bridge to do anything, so this double runs a MINIMAL real
 *  dispatch→reduce loop (mirrors game.js's fold, scoped to this one module) instead of no-op'ing it away. */
function make_spectator_context() {
  const events = new EventEmitter()
  let state = {
    observed_peers: new Map(),
    sui: { characters: [] }, // ← ZERO own-roster: the whole point of the proof
  }
  const reducer = presence()
  return {
    events,
    get_state: () => state,
    dispatch: (type, payload) => {
      state = reducer.reduce(state, { type, payload })
      events.emit('STATE_UPDATED', state)
    },
    get state() {
      return state
    },
  }
}

test('foreign avatar builds from a core peer row with an EMPTY own-roster (spectate)', async () => {
  const ctx = make_spectator_context()
  presence().observe(ctx)

  // A remote peer's decoded room position.
  presence_input({ type: 'peer_pos', id: 'peer_char_0xABC', x: 5, y: 7, h: 0 })

  // The bridge must have inserted the foreign avatar into observed_peers from the peer row alone.
  const entry = ctx.state.observed_peers.get('peer_char_0xABC')
  expect(entry).toBeDefined()
  expect(entry.position).toEqual({ x: 5, y: 0, z: 7 })
  // Fallback identity (no chain reply in spectate) — renders as the default class/sprite, never crashes.
  expect(entry.classe).toBe('senshi')
  expect(entry.sprites).toBe('/sprites/senshi')

  // Let the mocked (rejecting) identity read settle — the placeholder must SURVIVE, not throw.
  await new Promise((r) => setTimeout(r, 0))
  expect(ctx.state.observed_peers.get('peer_char_0xABC')).toBeDefined()
})

test('despawn removes the foreign avatar (peer left the room)', () => {
  const ctx = make_spectator_context()
  presence().observe(ctx)
  presence_input({ type: 'peer_pos', id: 'peer_1', x: 1, y: 1 })
  expect(ctx.state.observed_peers.has('peer_1')).toBe(true)
  presence_input({ type: 'peer_leave', id: 'peer_1' })
  expect(ctx.state.observed_peers.has('peer_1')).toBe(false)
})

test('identity requests are NEVER left unanswered: sdk resolves but the read leg fails → record:null through the door', async () => {
  // get_sdk RESOLVES with a stub client whose read throws — the executor's read leg fails either way
  // (pre-merge: the chain/read_character module is absent; post-merge: the stub's getObject throws), and the
  // door must still receive `peer_identity record:null` (the fold bumps roster_seq; the placeholder stands).
  set_expedition_sdk_mock(async () => ({
    grpc_client: { core: { getObject: async () => { throw new Error('stubbed read') } } },
  }))
  presence_input({ type: 'peer_pos', id: 'peer_deg', x: 2, y: 2 })
  const spawned_seq = presence_store.getState().roster_seq
  const deadline = Date.now() + 500
  while (presence_store.getState().roster_seq === spawned_seq && Date.now() < deadline)
    await new Promise((r) => setTimeout(r, 5))
  expect(presence_store.getState().roster_seq).toBe(spawned_seq + 1) // the null answer LANDED (never unanswered)
  expect(presence_store.getState().peers.get('peer_deg')?.chain).toBe(null) // honest degradation — placeholder identity
})
