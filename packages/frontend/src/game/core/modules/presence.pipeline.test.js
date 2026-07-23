// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// D770a-GONE PROOF (BRIDGE-A) — presence.js's observe() must be a THIN EDGE that only FORWARDS peer facts
// (mirrors chat.test.js's mount_chat idiom): it may never reach into `get_state()` and mutate
// `visible_characters` itself. The actual spawn/retarget/despawn projection lives in reduce(), reached only
// through dispatch. Proof shape: mount observe() with a NO-OP dispatch double (same trick chat.test.js uses,
// just inverted) — if the module still mutated state directly (the old D770a store->store glue), state would
// change even though dispatch never applied anything. It must NOT: only reduce() may write visible_characters.

import { afterEach, beforeEach, expect, test } from 'bun:test'

import '../../../test_helpers/expedition_sdk_mock.js'
import { presence_store, presence_input } from '../../../world-shell/presence_adapter.js'
import presence from './presence.js'

const reset = () => presence_store.getState().input({ type: 'reset' })
beforeEach(reset)
afterEach(reset)

/** Mount presence's observe with a NO-OP dispatch double (records calls, applies nothing) + a fixed state. */
function mount_presence() {
  const dispatched = []
  const state = { visible_characters: new Map(), sui: { characters: [] } }
  presence().observe({
    get_state: () => state,
    dispatch: (type, payload) => dispatched.push({ type, payload }),
  })
  return { dispatched, state }
}

test('observe() never mutates visible_characters directly — it only dispatches a peer input', () => {
  const { dispatched, state } = mount_presence()
  presence_input({ type: 'peer_pos', id: 'peer_shape', x: 5, y: 7 })

  // D770a GONE: a no-op dispatch means NOTHING may write to state — the old glue wrote straight through
  // presence_store.subscribe(sync) and would populate this regardless of dispatch.
  expect(state.visible_characters.has('peer_shape')).toBe(false)

  // The reducer's input surface: observe() forwarded the peer fact as a real action instead.
  expect(dispatched.length).toBeGreaterThan(0)
  expect(dispatched.at(-1).type).toBe('action/presence_snapshot')
  expect(dispatched.at(-1).payload.some((row) => row.id === 'peer_shape')).toBe(true)
})

test('reduce() alone (no observe, no store) projects the dispatched snapshot into visible_characters', () => {
  const state = { visible_characters: new Map() }
  const rows = [{ id: 'peer_reduced', name: 'Bob', classe: 'senshi', male: true, color_1: 0, position: { x: 1, y: 0, z: 2 }, target_yaw: 0 }]
  const next = presence().reduce(state, { type: 'action/presence_snapshot', payload: rows })
  expect(next.visible_characters.get('peer_reduced')?.position).toEqual({ x: 1, y: 0, z: 2 })
})

// #595 — SHARED-MAP GUARD: visible_characters has a SECOND writer (group_wiring.js's apply_follow, an owned
// follower's render row — never a p2p fact, so it never rides an action/presence_snapshot payload). Before this
// fix, reduce()'s "freshness law" wipe iterated EVERY key currently in the Map and reaped anything absent from
// ITS OWN payload — collateral-deleting the other writer's rows every single p2p tick, a beat ahead of
// apply_follow's own next tick restoring them. remote_players.js reacts correctly (same-tick teardown) to a row
// vanishing, so the entity itself never truly leaked — but the OWNER ROW leaving and returning off an
// uncoordinated race is exactly the invariant violation #595 reports: a live-followed pet/avatar cycling
// torn-down/respawned for no game-logic reason. Each reducer must only reap the rows IT lists.
test('reduce() never reaps an owned_follow row absent from its own p2p payload (#595)', () => {
  const vc = new Map([
    [
      'follower_1',
      {
        id: 'follower_1',
        name: 'Alt',
        classe: 'senshi',
        male: true,
        position: { x: 5, y: 0, z: 5 },
        target_position: { x: 5, y: 0, z: 5 },
        target_yaw: 0,
        action: 'IDLE',
        owned_follow: true, // group_wiring.js's build_follow_entries marker — a different writer's row
      },
    ],
  ])
  const state = { visible_characters: vc }
  const rows = [{ id: 'real_peer', name: 'Bob', classe: 'senshi', male: true, position: { x: 1, y: 0, z: 2 }, target_yaw: 0 }]
  const next = presence().reduce(state, { type: 'action/presence_snapshot', payload: rows })
  expect(next.visible_characters.has('follower_1')).toBe(true) // survives — not this reducer's row to reap
  expect(next.visible_characters.has('real_peer')).toBe(true) // the real p2p peer still projects normally
  // a genuinely expired P2P PEER (no owned_follow marker) is still despawned — the freshness law still holds
  // for the rows this reducer actually owns.
  const stale_peer_state = {
    visible_characters: new Map([['stale_peer', { id: 'stale_peer', name: 'Gone', position: { x: 0, y: 0, z: 0 } }]]),
  }
  const after_stale = presence().reduce(stale_peer_state, { type: 'action/presence_snapshot', payload: [] })
  expect(after_stale.visible_characters.has('stale_peer')).toBe(false)
})
