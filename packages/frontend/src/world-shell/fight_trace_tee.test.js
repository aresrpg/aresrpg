// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { create_fight_store } from '@aresrpg/fight/store'

import { install_fight_trace_tee } from './fight_trace_tee.js'

// A fresh window per test: enablement rides ONLY the global flag (search is '' so the memoized url parse
// is a stable false), and a fresh window resets the one-time install latch.
const fresh_window = () => {
  globalThis.window = { location: { search: '' } }
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
    expect(captured[1].payload).toEqual({ kind: 'player_draft', draft_kind: 'arm', spell_id: 'vault' })
    // input_seq is monotonic across the capture stream
    expect(captured[1].input_seq).toBe(captured[0].input_seq + 1)
    expect(captured[2].input_seq).toBe(captured[1].input_seq + 1)
  })

  test('the dump is a portable trace_format-2 capsule of the ring', () => {
    const store = create_fight_store()
    enable()
    install_fight_trace_tee(store)
    store.getState().input({ type: 'tick' }, 200)
    const dump = globalThis.window.__ARES_FIGHT_CAPSULE_DUMP()
    expect(dump.trace_format).toBe(2)
    expect(dump.envelope_version).toBe(1)
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
    const before = ring().length
    // record_input reads msg.fight_id for the session id; a throwing getter blows up the TAP only. The
    // tick reducer never reads msg.fight_id, so the fight is untouched.
    const poison = {
      type: 'tick',
      get fight_id() {
        throw new Error('boom')
      },
    }
    expect(() => store.getState().input(poison, 300)).not.toThrow()
    expect(ring().length).toBe(before) // the faulted capsule was dropped, not half-written
    // the store still works after
    store.getState().input({ type: 'arm', spell_id: 'x' })
    expect(store.getState().armed_spell_id).toBe('x')
  })
})

// ── v2 SHADOW FAN-OUT (build-order step 3, issue #522) — the second consumer riding the ONE tap ──────────
// fight_v2_shadow.test.js pins the driver's own logic (converge / throttle / capsule) in isolation. These
// tests pin the WIRING: the real store, the real classify_input bridge, the arm gate, and that disarmed
// really means zero work — exactly the shape a real fight dispatches through dungeon_run_store.js.
describe('v2 shadow fan-out — the second consumer riding the one tap', () => {
  const FIGHT = '0xf1647'
  const ME = '0xchar_a'
  const ev = (kind, json) => ({ type: `0xpkg::fight_events::${kind}`, parsedJson: { fight: FIGHT, ...json } })
  // The decoded-Fight shape board_state_from_fight expects (harness/fixtures.js's fight_object, inlined —
  // that harness lives in @aresrpg/fight's own test tree, not an exported package surface).
  const fight_object = () => ({
    id: FIGHT,
    status: 1,
    width: 20,
    height: 19,
    participants: [
      {
        owner: '0xa11ce',
        character: ME,
        class: 'warrior',
        team: 0,
        hp: 50,
        max_hp: 50,
        ap: 12,
        mp: 3,
        base_ap: 12,
        base_mp: 3,
        cell: 21,
        ready: true,
        casts_this_turn: 0,
        weapon: null,
      },
    ],
    group_template: '0xmob_t',
    group_base_ap: 6,
    group_base_mp: 3,
    mobs: [{ template: '0xmob_t', level: 3, hp: 20, max_hp: 20, cell: 45, ap: 6, mp: 3 }],
    obstacles: [],
    holes: [],
    shape_mask: [],
    start_cells_a: [21, 22],
    start_cells_b: [],
    turn_ptr: 0,
    queue: [],
    turn_deadline_ms: 0,
    placement_deadline_ms: 0,
    world_seed: null,
    spawn_id: null,
    last_action_ms: 0,
  })

  const arm_shadow = () => {
    globalThis.window.__ARES_FIGHT_SHADOW_ENABLED = true
  }
  const shadow_status = () => globalThis.window.__ARES_FIGHT_SHADOW

  test('a real fight flow (init → snapshot → receipt) converges: zero divergences, no log, no capsule', () => {
    const store = create_fight_store()
    arm_shadow()
    install_fight_trace_tee(store)
    store
      .getState()
      .input(
        { type: 'init', fight_id: FIGHT, ctx: { my_entity_id: ME, address: '0xa11ce', beat_ctx: { grid_width: 20 } } },
        1000
      )
    store.getState().input({ type: 'snapshot', fight: fight_object(), version: 1 }, 1010)
    store.getState().input(
      {
        type: 'receipt',
        receipt: { events: [ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: 30000 })] },
        version: 2,
      },
      1100
    )

    expect(shadow_status()).toMatchObject({ fights_shadowed: 1, divergences: 0, last: null })
    expect(globalThis.window.__ARES_FIGHT_SHADOW_CAPSULE).toBeUndefined()
  })

  test('disarmed (no v2shadow flag): zero shadow work — the fight still runs untouched', () => {
    const store = create_fight_store()
    // no arm_shadow() call — the shadow stays off regardless of fighttrace
    install_fight_trace_tee(store)
    store.getState().input({ type: 'init', fight_id: FIGHT, ctx: { my_entity_id: ME } }, 1000)
    store.getState().input({ type: 'snapshot', fight: fight_object(), version: 1 }, 1010)

    expect(store.getState().fight_id).toBe(FIGHT) // the real fight ran
    expect(shadow_status()).toBeUndefined() // zero work: the status surface never gets created
    expect(globalThis.window.__ARES_FIGHT_SHADOW_CAPSULE).toBeUndefined()
  })

  test('ONE TAP, TWO CONSUMERS: the capsule ring and the shadow status both update from the SAME dispatches', () => {
    const store = create_fight_store()
    enable() // the pre-existing fighttrace ring
    arm_shadow() // the new shadow consumer
    install_fight_trace_tee(store)
    store
      .getState()
      .input({ type: 'init', fight_id: FIGHT, ctx: { my_entity_id: ME, beat_ctx: { grid_width: 20 } } }, 1000)
    store.getState().input({ type: 'snapshot', fight: fight_object(), version: 1 }, 1010)

    expect(ring().length).toBeGreaterThan(0) // the ring recorder behaves exactly as before this file grew a 2nd consumer
    expect(shadow_status().fights_shadowed).toBe(1) // the shadow observed the SAME inputs off the SAME wrap
  })

  test('a fault in the shadow consumer is isolated — the store stays correct, the shadow just misses that one', () => {
    const store = create_fight_store()
    arm_shadow() // fighttrace stays OFF so record_input never touches msg.cell — isolates the fault to feed_shadow
    install_fight_trace_tee(store)
    // classify_input's board_click always reads msg.cell; the store's own handler only reads it when a spell
    // is armed (short-circuits otherwise) — nothing is armed here, so ONLY the shadow path touches msg.cell.
    const poison = {
      type: 'board_click',
      targetable: true,
      get cell() {
        throw new Error('boom')
      },
    }
    expect(() => store.getState().input(poison, 1000)).not.toThrow()
    expect(shadow_status()).toBeUndefined() // the faulted envelope never reached a status publish
    store.getState().input({ type: 'arm', spell_id: 'x' })
    expect(store.getState().armed_spell_id).toBe('x') // the store still works after
  })
})
