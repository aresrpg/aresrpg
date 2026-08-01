// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #1799 — CORE-OWNED FACTS GET EXACTLY ONE WRITE DOOR. The store's migration to its `core` atom left legacy
// top-level copies beside the canonical home, re-derived on every input. Each copy is a second source of truth
// wearing a migration excuse: one missed mirror splits presentation from the canonical log.
//
// These rows are DIVERGENCE-SHAPED by construction. A store driven through the real door can never disagree with
// its own mirror (the same reducer writes both), so the fixture installs a core the store has NOT seen — folded
// through the PUBLIC core door, never a hand-written atom — and asserts the reader lands on the CORE's value.
// A reader that still consults the mirror reads the stale one and fails.

import { describe, test, expect } from 'bun:test'

import { create_fight_store } from '../src/store.js'
import { engine_view } from '../src/project.js'
import { empty_core_state, ingest } from '../src/core.js'
import { input_envelope } from '../src/envelope.js'
import { classify_input } from '../src/classify_input.js'

const FIGHT = '0xf19h7'
const PENDING = '0xpend1n6'
const CHAR = '0xa11ce'

const active_fight = () => ({
  width: 12,
  height: 12,
  status: 1,
  participants: [{ character: CHAR, cell: '5', hp: '70', ap: '6', mp: '3' }],
  mobs: [{ cell: '9', hp: '80' }],
})

const receipt = (version, extra = {}) => ({
  type: 'receipt',
  fight_id: FIGHT,
  version,
  ...extra,
  receipt: {
    events: [
      {
        type: '0x0::fight_events::TurnStarted',
        parsedJson: { fight: FIGHT, is_mob: false, idx: 0, deadline_ms: 1784000000000 },
      },
    ],
  },
})

const SHARED = [
  { msg: { type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: {} }, at: 1 },
  { msg: { type: 'snapshot', fight_id: FIGHT, version: 100, fight: active_fight() }, at: 2 },
  { msg: receipt(200), at: 3 },
]

/** Fold a message stream through the PUBLIC core door — the same bridge the store's own door uses. */
const core_of = (stream, from = empty_core_state()) =>
  stream.reduce(
    (core, { msg, at }, index) =>
      ingest(
        core,
        input_envelope({
          session_id: msg?.fight_id ?? null,
          input_seq: index,
          observed_at_ms: at,
          payload: classify_input(msg),
        })
      ),
    from
  )

const driven_store = (stream = SHARED) => {
  const store = create_fight_store()
  for (const { msg, at } of stream) store.getState().input(msg, at)
  return store
}

describe('#1799 · the journal delivery cursor lives in the core inbox alone', () => {
  test('the store atom carries NO accept_state beside `core.inbox.delivered_seq`', () => {
    const state = driven_store().getState()
    expect(state.core.inbox.delivered_seq).toBeDefined() // the ONE home exists…
    expect('accept_state' in state).toBe(false) // …and nothing mirrors it
  })
})

describe('#1799 · the session generation lives in the core alone', () => {
  test('the identity gate refuses against the CORE generation, not a store-local copy', () => {
    const store = driven_store()
    expect(store.getState().core.session_generation).toBe(1)
    // Two more boots reach the core alone: the core is at generation 3, any store-local mirror is still at 1.
    const ahead = core_of(
      [
        { msg: { type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: {} }, at: 4 },
        { msg: { type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: {} }, at: 5 },
        { msg: { type: 'snapshot', fight_id: FIGHT, version: 100, fight: active_fight() }, at: 6 },
      ],
      store.getState().core
    )
    expect(ahead.session_generation).toBe(3)
    store.setState({ core: ahead })

    // A message stamped with the CORE's live generation is the current session's — it must be admitted.
    store.getState().input(receipt(300, { session_generation: 3 }), 7)
    expect(store.getState().refused).toBeNull()

    // …and one stamped with the superseded generation is refused, off the same one home.
    store.getState().input(receipt(400, { session_generation: 1 }), 8)
    expect(store.getState().refused).toMatchObject({ reason: 'session_generation', got: 1, want: 3 })
  })

  test('the store atom carries NO session_generation beside the core’s', () => {
    expect('session_generation' in driven_store().getState()).toBe(false)
  })
})

describe('#1799 · the adopted base version lives in the core inbox alone', () => {
  test('the fold floor follows the CORE’s base_version when a store-local copy would disagree', () => {
    const store = driven_store()
    expect(store.getState().core.inbox.base_version).toBe(100)
    // A far-ahead snapshot the core adopted and the presentation adapter never saw.
    const ahead = core_of(
      [{ msg: { type: 'snapshot', fight_id: FIGHT, version: 900, fight: active_fight() }, at: 4 }],
      store.getState().core
    )
    expect(ahead.inbox.base_version).toBe(900)
    store.setState({ core: ahead })

    store.getState().input({ type: 'ctx', ctx: {} }, 5) // any input that re-folds
    // The floor is the adopted base: everything at/below it is already baked into the base view.
    expect(store.getState().applied_version).toBe(900)
    expect('view_version' in store.getState()).toBe(false)
  })
})

describe('#1799 · a re-key moves the session id in ONE place', () => {
  test('the adopted base view is chain data, never a second identity home', () => {
    const store = driven_store([
      { msg: { type: 'init', fight_id: PENDING, my_key: 'p0', ctx: {} }, at: 1 },
      { msg: { type: 'snapshot', fight_id: PENDING, version: 100, fight: active_fight() }, at: 2 },
      { msg: { type: 'rekey', from: PENDING, to: FIGHT }, at: 3 },
    ])
    const state = store.getState()
    expect(state.core.fight_id).toBe(FIGHT) // the ONE identity home moved
    expect(engine_view(state).fight_id).toBe(FIGHT) // …and the renderer reads it there
    // The snapshot the session adopted is untouched by the re-key — no second id write to drift from the core.
    expect(state.view.id).toBe(state.core.inbox.base_view.id)
  })
})
