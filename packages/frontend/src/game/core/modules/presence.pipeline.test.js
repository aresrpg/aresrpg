// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// D770a-GONE PROOF (BRIDGE-A) — presence.js's observe() must be a THIN EDGE that only FORWARDS peer facts
// (mirrors chat.test.js's mount_chat idiom): it may never reach into `get_state()` and mutate `observed_peers`
// itself. The actual spawn/retarget/despawn projection lives in reduce(), reached only through dispatch.
// Proof shape: mount observe() with a NO-OP dispatch double (same trick chat.test.js uses, just inverted) —
// if the module still mutated state directly (the old D770a store->store glue), state would change even
// though dispatch never applied anything. It must NOT: only reduce() may write observed_peers.

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
  const state = { observed_peers: new Map(), sui: { characters: [] } }
  presence().observe({
    get_state: () => state,
    dispatch: (type, payload) => dispatched.push({ type, payload }),
  })
  return { dispatched, state }
}

test('observe() never mutates observed_peers directly — it only dispatches a peer input', () => {
  const { dispatched, state } = mount_presence()
  presence_input({ type: 'peer_pos', id: 'peer_shape', x: 5, y: 7 })

  // D770a GONE: a no-op dispatch means NOTHING may write to state — the old glue wrote straight through
  // presence_store.subscribe(sync) and would populate this regardless of dispatch.
  expect(state.observed_peers.has('peer_shape')).toBe(false)

  // The reducer's input surface: observe() forwarded the peer fact as a real action instead.
  expect(dispatched.length).toBeGreaterThan(0)
  expect(dispatched.at(-1).type).toBe('action/presence_snapshot')
  expect(dispatched.at(-1).payload.some((row) => row.id === 'peer_shape')).toBe(true)
})

// The edge stamps WHEN each observation was received — a reducer may not read a clock, and an observation
// with no age is one a consumer cannot weigh (realtime constitution D2).
test('observe() stamps every forwarded row with its observation time', () => {
  const { dispatched } = mount_presence()
  presence_input({ type: 'peer_pos', id: 'peer_stamped', x: 5, y: 7 })

  const row = dispatched.at(-1).payload.find((candidate) => candidate.id === 'peer_stamped')
  expect(typeof row.observed_at).toBe('number')
  expect(row.observed_at).toBeGreaterThan(0)
})

test('reduce() alone (no observe, no store) projects the dispatched snapshot into observed_peers', () => {
  const state = { observed_peers: new Map() }
  const rows = [
    {
      id: 'peer_reduced',
      name: 'Bob',
      classe: 'senshi',
      male: true,
      color_1: 0,
      position: { x: 1, y: 0, z: 2 },
      target_yaw: 0,
      observed_at: 1_000,
    },
  ]
  const next = presence().reduce(state, { type: 'action/presence_snapshot', payload: rows })
  expect(next.observed_peers.get('peer_reduced')?.position).toEqual({ x: 1, y: 0, z: 2 })
  expect(next.observed_peers.get('peer_reduced')?.observed_at).toBe(1_000)
})

// SINGLE-WRITER LAW (the successor to #595's shared-map guard). That guard existed because group_wiring.js's
// apply_follow wrote MY OWN followers — locally driven, never a p2p fact — into the very same Map this
// reducer swept, so each writer kept reaping the other's rows. The two facts now live in two homes and this
// reducer owns exactly one of them: it may sweep every row it did not list, because every row here is its own.
test('reduce() owns its whole map — an unlisted observation is reaped, and nothing else is in reach', () => {
  const state = {
    observed_peers: new Map([['stale_peer', { id: 'stale_peer', name: 'Gone', position: { x: 0, y: 0, z: 0 } }]]),
    owned_follow_render_rows: new Map([['follower_1', { id: 'follower_1', name: 'Alt', owned_follow: true }]]),
  }
  const rows = [{ id: 'real_peer', name: 'Bob', classe: 'senshi', male: true, position: { x: 1, y: 0, z: 2 } }]
  const next = presence().reduce(state, { type: 'action/presence_snapshot', payload: rows })

  expect(next.observed_peers.has('real_peer')).toBe(true) // the listed observation projects
  expect(next.observed_peers.has('stale_peer')).toBe(false) // the unlisted one is gone — the freshness law
  // My own follower is untouched because it was never in this reducer's map to touch.
  expect(next.owned_follow_render_rows.get('follower_1')).toMatchObject({ id: 'follower_1' })
})
