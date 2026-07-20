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
