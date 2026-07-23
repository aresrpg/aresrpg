// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// STORE REPLAY (issue #209, RED-FIRST) — the proof a captured fight trace IS the fight's capsule: a
// wire-input sequence, dumped from the real tap wired into fight/store's ONE door (make_input), folds back
// through a FRESH store and reproduces the exact same projection. dev_synth_fight.js already proves the
// pattern in production (a synthetic input sequence folds through the real store to mount a real board); this
// pins it as a gate so the tap/dump/replay chain can never silently drift. Fixture mirrors scenario_solo.test.js's
// proven fight_object/ev shape (copy > abstract — the house convention for test fixtures in this package).

import { describe, test, expect } from 'bun:test'

import { create_fight_store } from './store.js'
import { dump_current_trace, _reset_trace_for_test } from './trace_tap.js'

const FIGHT = '0xtrace_replay_fight'
const ME = '0xchar_trace_replay'
const OWNER = '0xowner_trace_replay'
const T0 = 1_000_000

const ev = (kind, json) => ({ type: `0xpkg::fight_events::${kind}`, parsedJson: { fight: FIGHT, ...json } })

/** A decoded-Fight-shaped PLAIN object — the board_state_from_fight input contract. */
const fight_object = () => ({
  id: FIGHT,
  status: 1, // engine ACTIVE
  width: 20,
  height: 19,
  participants: [
    {
      owner: OWNER,
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
  mobs: [{ template: '0xmob_t', level: 3, hp: 40, max_hp: 40, cell: 45, ap: 6, mp: 3 }],
  obstacles: [],
  holes: [],
  shape_mask: [],
  start_cells_a: [21, 22],
  start_cells_b: [],
  turn_ptr: 0,
  queue: [],
  turn_deadline_ms: T0 + 90_000,
  placement_deadline_ms: 0,
  world_seed: null,
  spawn_id: null,
  last_action_ms: 0,
})

// A full turn exchange (my cast + hit, the mob's counter move + cast + hit) — 8 events, enough for "timeline
// length" to mean something, and concrete HP deltas on both sides for "final HP" to pin.
const turn_receipt = () => ({
  events: [
    ev('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: 45 }),
    ev('Hit', {
      victim_is_mob: true,
      victim_idx: 0,
      amount: 20,
      remaining_hp: 20,
      caster_is_mob: false,
      caster_idx: 0,
    }),
    ev('TurnEnded', { is_mob: false, idx: 0 }),
    ev('TurnStarted', { is_mob: true, idx: 0 }),
    ev('MobMoved', { idx: 0, to_cell: 41 }),
    ev('Cast', { caster_is_mob: true, caster_idx: 0, target_cell: 21 }),
    ev('Hit', { victim_is_mob: false, victim_idx: 0, amount: 6, remaining_hp: 44, caster_is_mob: true, caster_idx: 0 }),
    ev('TurnEnded', { is_mob: true, idx: 0 }),
  ],
})

/** Drive a store through init -> snapshot -> receipt, exactly as the live client would (the tap wired into
 *  make_input captures this live, unattended — nothing here talks to the tap directly). */
const drive_fight = () => {
  const store = create_fight_store()
  store
    .getState()
    .input(
      { type: 'init', fight_id: FIGHT, ctx: { my_entity_id: ME, address: OWNER, beat_ctx: { grid_width: 20 } } },
      T0
    )
  store.getState().input({ type: 'snapshot', fight: fight_object(), version: 1 }, T0 + 100)
  store.getState().input({ type: 'receipt', receipt: turn_receipt(), version: 2 }, T0 + 2_000)
  return store
}

describe('a captured fight trace replays through a fresh store (the store IS the reducer, its input log is its capsule)', () => {
  test('folding trace.inputs through a fresh create_fight_store() reproduces the SAME committed HP + timeline length', () => {
    _reset_trace_for_test() // module-level tap singleton — isolate from whatever else shared this test process

    const original = drive_fight()
    // ground truth this test does NOT get from the tap: the exact numbers the live drive produced.
    expect(original.getState().fighters.m0.hp).toBe(20)
    expect(original.getState().fighters.p0.hp).toBe(44)
    const original_timeline_length = Object.keys(original.getState().entries).length
    expect(original_timeline_length).toBe(8) // one folded action entry per receipt event

    const trace = dump_current_trace('trace-replay-test', T0 + 5_000, FIGHT)
    expect(trace).not.toBe(null)
    expect(trace.inputs.map((i) => i.msg.type)).toEqual(['init', 'snapshot', 'receipt'])

    // REPLAY: a completely fresh store, fed ONLY the dumped inputs, in order — nothing else.
    const replayed = create_fight_store()
    for (const { msg, at } of trace.inputs) replayed.getState().input(msg, at)

    // the projection fact: final presented HP on both sides matches the live drive exactly.
    expect(replayed.getState().fighters.m0.hp).toBe(original.getState().fighters.m0.hp)
    expect(replayed.getState().fighters.p0.hp).toBe(original.getState().fighters.p0.hp)
    // the projection fact: timeline length (the folded action log) matches exactly — nothing lost, nothing added.
    expect(Object.keys(replayed.getState().entries).length).toBe(original_timeline_length)
  })

  test('nothing captured yet (no fight opened) dumps null — never a fabricated empty trace', () => {
    _reset_trace_for_test()
    expect(dump_current_trace('trace-replay-test', T0)).toBe(null)
  })
})

describe('the reducer-door trace belongs to its store instance', () => {
  test('two fresh stores keep independent recorder histories', () => {
    const first = create_fight_store()
    const second = create_fight_store()
    first.getState().input({ type: 'init', fight_id: '0xfirst' }, T0)
    second.getState().input({ type: 'init', fight_id: '0xsecond' }, T0 + 1)

    expect(first.trace_tap.dump_current_trace('test', T0 + 2).fight_id).toBe('0xfirst')
    expect(first.trace_tap.dump_current_trace('test', T0 + 2, '0xsecond')).toBe(null)
    expect(second.trace_tap.dump_current_trace('test', T0 + 2).fight_id).toBe('0xsecond')
    expect(second.trace_tap.dump_current_trace('test', T0 + 2, '0xfirst')).toBe(null)
  })

  test('a diagnostic consumer fault never breaks the input door', () => {
    const store = create_fight_store()
    const poison = {
      type: 'tick',
      get fight_id() {
        throw new Error('boom')
      },
    }
    expect(() => store.getState().input(poison, T0)).not.toThrow()
    store.getState().input({ type: 'arm', spell_id: 'x' }, T0 + 1)
    expect(store.getState().armed_spell_id).toBe('x')
  })
})
