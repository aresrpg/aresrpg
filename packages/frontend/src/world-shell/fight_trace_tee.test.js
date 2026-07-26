// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { create_fight_store } from '@aresrpg/fight/store'

import { install_fight_trace_tee } from './fight_trace_tee.js'

// A fresh window per test: enablement rides ONLY the global flag (search is '' so the memoized url parse
// is a stable false), and a fresh window resets the one-time install latch.
const fresh_window = (search = '') => {
  globalThis.window = { location: { search } }
  return globalThis.window
}

beforeEach(() => fresh_window())
afterEach(() => {
  delete globalThis.window
})

const enable = () => {
  globalThis.window.__ARES_FIGHT_TRACE_ENABLED = true
}
const ring = () => globalThis.window.__ARES_FIGHT_CAPSULE ?? []

describe('fight_trace_tee — transparent capture on the door', () => {
  test('ZERO behavior change: the original input still runs (state mutates as before)', () => {
    const store = create_fight_store()
    enable()
    install_fight_trace_tee(store)
    store.getState().input({ type: 'arm', spell_id: 'warcleave' })
    // the real reducer ran — the tap only observed around it
    expect(store.getState().armed_spell_id).toBe('warcleave')
  })

  test('every dispatch lands in the ring as its classified envelope', () => {
    const store = create_fight_store()
    enable()
    install_fight_trace_tee(store)
    store.getState().input({ type: 'init', fight_id: '0xfeed', my_key: null }, 100)
    store.getState().input({ type: 'arm', spell_id: 'vault' }, 101)
    store.getState().input({ type: 'tick' }, 102)

    const captured = ring().slice(-3)
    expect(captured.map((e) => e.payload.kind)).toEqual(['session_opened', 'player_draft', 'clock_observed'])
    // provenance is carried honestly: the session id, the tap clock, the classified payload
    expect(captured[0]).toMatchObject({
      envelope_version: 1,
      session_id: '0xfeed',
      observed_at_ms: 100,
      payload: { kind: 'session_opened', fight_id: '0xfeed', my_key: null },
    })
    expect(captured.map((e) => e.session_id)).toEqual(['0xfeed', '0xfeed', '0xfeed'])
    expect(captured[1].payload).toEqual({ kind: 'player_draft', draft_kind: 'arm', spell_id: 'vault' })
    // input_seq is monotonic across the capture stream
    expect(captured[1].input_seq).toBe(captured[0].input_seq + 1)
    expect(captured[2].input_seq).toBe(captured[1].input_seq + 1)
  })

  test('the dump is a portable trace_format-2 capsule of the ring', () => {
    const store = create_fight_store()
    enable()
    install_fight_trace_tee(store)
    store.getState().input({ type: 'init', fight_id: '0xdump', my_key: null }, 199)
    store.getState().input({ type: 'tick' }, 200)
    const dump = globalThis.window.__ARES_FIGHT_CAPSULE_DUMP()
    expect(dump.trace_format).toBe(2)
    expect(dump.envelope_version).toBe(1)
    expect(dump.session_id).toBe('0xdump')
    expect(Array.isArray(dump.capsules)).toBe(true)
    expect(dump.capsules.at(-1).payload.kind).toBe('clock_observed')
  })

  test('install is idempotent — a second call does not double-wrap', () => {
    const store = create_fight_store()
    enable()
    install_fight_trace_tee(store)
    const once = store.getState().input
    install_fight_trace_tee(store)
    expect(store.getState().input).toBe(once)
  })

  test('install ownership is per store instance, even when stores share one window', () => {
    const first = create_fight_store()
    const second = create_fight_store()
    enable()
    const first_original = first.getState().input
    const second_original = second.getState().input
    install_fight_trace_tee(first)
    install_fight_trace_tee(second)
    expect(first.getState().input).not.toBe(first_original)
    expect(second.getState().input).not.toBe(second_original)
  })

  test('capture sequence and URL enablement are owned by each installation', () => {
    const enabled_store = create_fight_store()
    fresh_window('?fighttrace=1')
    install_fight_trace_tee(enabled_store)
    enabled_store.getState().input({ type: 'tick' }, 1)
    expect(ring().map((entry) => entry.input_seq)).toEqual([0])

    const disabled_store = create_fight_store()
    fresh_window('')
    install_fight_trace_tee(disabled_store)
    disabled_store.getState().input({ type: 'tick' }, 2)
    expect(ring()).toEqual([])
  })

  test('disabled (no flag): the fight runs, nothing is captured', () => {
    const store = create_fight_store()
    // no enable() — the tee is off
    install_fight_trace_tee(store)
    const before = ring().length
    store.getState().input({ type: 'arm', spell_id: 'oathblade' })
    expect(store.getState().armed_spell_id).toBe('oathblade') // behavior intact
    expect(ring().length).toBe(before) // nothing recorded
  })

  test('a fault in the TAP is isolated — the fight runs, that capsule is silently dropped', () => {
    const store = create_fight_store()
    enable()
    install_fight_trace_tee(store)
    Object.defineProperty(globalThis.window, '__ARES_FIGHT_CAPSULE', {
      configurable: true,
      get() {
        throw new Error('boom')
      },
    })
    // Reading the consumer-owned ring blows up the TAP only. The reducer never touches window, so its input
    // door must still run and the faulted capsule must be dropped rather than half-written.
    expect(() => store.getState().input({ type: 'arm', spell_id: 'x' }, 300)).not.toThrow()
    expect(store.getState().armed_spell_id).toBe('x')
    delete globalThis.window.__ARES_FIGHT_CAPSULE
    expect(ring()).toEqual([])
  })
})
