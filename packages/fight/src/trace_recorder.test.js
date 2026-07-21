// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// TRACE RECORDER (issue #209) — the pure ring buffer's own invariants, mirroring packages/sim/test/
// recorder.test.js's RING/DUMP sections (same contract, adapted to store-input messages instead of sim
// commands). The end-to-end "captured trace replays through the real store" proof lives in
// trace_store_replay.test.js — this file pins the buffer itself: eviction, fight-scoping, null-safety.

import { describe, test, expect } from 'bun:test'

import {
  create_trace_recorder,
  record_input,
  dump_trace,
  earliest_input_at,
  DEFAULT_TRACE_CAPACITY,
  TRACE_FORMAT,
} from './trace_recorder.js'

const anchors = { applied_version: -1, view_version: -1, receipt_seq: 0 }

describe('trace recorder ring buffer', () => {
  test('entries beyond capacity evict the oldest (seq monotonic, never reused)', () => {
    const filled = Array.from({ length: 6 }).reduce(
      (rec, _unused, i) => record_input(rec, { fight_id: 'f', msg: { type: 'tick', i }, at: i, anchors }),
      create_trace_recorder(4)
    )
    expect(filled.entries.length).toBe(4)
    expect(filled.seq).toBe(6)
    expect(filled.entries.map((entry) => entry.seq)).toEqual([2, 3, 4, 5])
  })

  test('create_trace_recorder guards a bad capacity to the default', () => {
    expect(create_trace_recorder(0).capacity).toBe(DEFAULT_TRACE_CAPACITY)
    expect(create_trace_recorder(-5).capacity).toBe(DEFAULT_TRACE_CAPACITY)
    expect(create_trace_recorder(3.5).capacity).toBe(DEFAULT_TRACE_CAPACITY)
    expect(create_trace_recorder(7).capacity).toBe(7)
    expect(create_trace_recorder().capacity).toBe(DEFAULT_TRACE_CAPACITY)
  })
})

// issue #241: dungeon_run_store.js's own "fight started" bind bookkeeping can come up empty (the dev synth-fight
// harness mounts a fight_id without it — confirmed by reading dev_synth_fight.js's use_dungeon.setState call,
// which never stamps fight_started_at_ms). earliest_input_at is the fallback source: the fight's OWN 'init'
// entry, recorded unconditionally at the ONE reducer door, independent of any caller's bind bookkeeping.
describe('earliest_input_at — the fallback fight-start source (issue #241)', () => {
  test('no entries at all → null (never a fabricated timestamp)', () => {
    expect(earliest_input_at(create_trace_recorder(), 'f')).toBe(null)
  })

  test('an unopened fight_id (never got an init) → null even with other traffic recorded', () => {
    const rec = record_input(create_trace_recorder(), { fight_id: 'other', msg: { type: 'tick' }, at: 5, anchors })
    expect(earliest_input_at(rec, 'f')).toBe(null)
  })

  test('an opened fight_id → the recorded wall-clock "at" of its init (RED-FIRST: this is the exact value a bind-less caller like the dev synth-fight harness needs)', () => {
    const rec = record_input(create_trace_recorder(), {
      fight_id: 'f',
      msg: { type: 'init', fight_id: 'f' },
      at: 1_000_000,
      anchors,
    })
    expect(earliest_input_at(rec, 'f')).toBe(1_000_000)
  })

  test('later traffic on the SAME fight never moves the anchor — always the init, not the latest entry', () => {
    let rec = record_input(create_trace_recorder(), {
      fight_id: 'f',
      msg: { type: 'init', fight_id: 'f' },
      at: 10,
      anchors,
    })
    rec = record_input(rec, { fight_id: 'f', msg: { type: 'tick' }, at: 20, anchors })
    rec = record_input(rec, { fight_id: 'f', msg: { type: 'tick' }, at: 30, anchors })
    expect(earliest_input_at(rec, 'f')).toBe(10)
  })

  test('a re-init (resume) on the SAME fight_id supersedes the earlier attempt — mirrors dump_trace scoping exactly', () => {
    let rec = record_input(create_trace_recorder(), {
      fight_id: 'f',
      msg: { type: 'init', fight_id: 'f' },
      at: 10,
      anchors,
    })
    rec = record_input(rec, { fight_id: 'f', msg: { type: 'tick' }, at: 20, anchors })
    rec = record_input(rec, { fight_id: 'f', msg: { type: 'init', fight_id: 'f' }, at: 50, anchors }) // resume/re-init
    expect(earliest_input_at(rec, 'f')).toBe(50)
  })

  test('scopes strictly to the requested fight_id — a second fight in the ring never leaks its anchor', () => {
    let rec = record_input(create_trace_recorder(), {
      fight_id: 'a',
      msg: { type: 'init', fight_id: 'a' },
      at: 1,
      anchors,
    })
    rec = record_input(rec, { fight_id: 'b', msg: { type: 'init', fight_id: 'b' }, at: 99, anchors })
    expect(earliest_input_at(rec, 'a')).toBe(1)
    expect(earliest_input_at(rec, 'b')).toBe(99)
  })

  test('an evicted init (past ring capacity) → null, same honesty as dump_trace', () => {
    const evicted = [1, 2].reduce(
      (rec, i) => record_input(rec, { fight_id: 'g', msg: { type: 'tick', i }, at: i, anchors }),
      record_input(create_trace_recorder(2), { fight_id: 'g', msg: { type: 'init', fight_id: 'g' }, at: 0, anchors })
    )
    expect(earliest_input_at(evicted, 'g')).toBe(null)
  })
})

describe('dump_trace', () => {
  test('an empty buffer dumps null (total, never throws)', () => {
    expect(dump_trace(create_trace_recorder(), 'v1', 0)).toBe(null)
  })

  test('inputs with no init dump null — nothing dumpable without an opening', () => {
    const no_init = record_input(create_trace_recorder(), { fight_id: 'f', msg: { type: 'tick' }, at: 1, anchors })
    expect(dump_trace(no_init, 'v1', 0)).toBe(null)
  })

  test('an evicted init yields null rather than a broken trace', () => {
    // capacity 2: the init (seq 0) is pushed out by the two ticks that follow -> not dumpable.
    const evicted = [1, 2].reduce(
      (rec, i) => record_input(rec, { fight_id: 'g', msg: { type: 'tick', i }, at: i, anchors }),
      record_input(create_trace_recorder(2), { fight_id: 'g', msg: { type: 'init', fight_id: 'g' }, at: 0, anchors })
    )
    expect(evicted.entries.some((entry) => entry.msg.type === 'init')).toBe(false)
    expect(dump_trace(evicted, 'v1', 0)).toBe(null)
  })

  test('scopes to ONE fight: a second init opens a fresh trace, the first fight is still dumpable by id', () => {
    let rec = record_input(create_trace_recorder(), {
      fight_id: 'a',
      msg: { type: 'init', fight_id: 'a' },
      at: 0,
      anchors,
    })
    rec = record_input(rec, { fight_id: 'a', msg: { type: 'tick' }, at: 1, anchors })
    rec = record_input(rec, { fight_id: 'b', msg: { type: 'init', fight_id: 'b' }, at: 2, anchors })
    rec = record_input(rec, { fight_id: 'b', msg: { type: 'tick' }, at: 3, anchors })

    const latest = dump_trace(rec, 'v1', 999) // no fight_id -> the most recently opened
    expect(latest.fight_id).toBe('b')
    expect(latest.inputs.map((i) => i.msg.type)).toEqual(['init', 'tick'])

    const earlier = dump_trace(rec, 'v1', 999, 'a')
    expect(earlier.fight_id).toBe('a')
    expect(earlier.inputs.map((i) => i.msg.type)).toEqual(['init', 'tick'])
  })

  test('a re-init on the SAME fight supersedes the earlier attempt (only the latest open + its tail dumps)', () => {
    let rec = record_input(create_trace_recorder(), {
      fight_id: 'a',
      msg: { type: 'init', fight_id: 'a' },
      at: 0,
      anchors,
    })
    rec = record_input(rec, { fight_id: 'a', msg: { type: 'tick', n: 1 }, at: 1, anchors })
    rec = record_input(rec, { fight_id: 'a', msg: { type: 'init', fight_id: 'a' }, at: 2, anchors }) // resume/re-init
    rec = record_input(rec, { fight_id: 'a', msg: { type: 'tick', n: 2 }, at: 3, anchors })

    const trace = dump_trace(rec, 'v1', 999, 'a')
    expect(trace.inputs.map((i) => i.at)).toEqual([2, 3]) // the FIRST attempt's tick (at:1) is gone
  })

  test('the dump carries the format label + caller-supplied app_version/captured_at, and JSON round-trips', () => {
    const rec = record_input(create_trace_recorder(), {
      fight_id: 'f',
      msg: { type: 'init', fight_id: 'f' },
      at: 0,
      anchors,
    })
    const trace = dump_trace(rec, '1.12.99', 1_700_000_000_000, 'f')
    expect(trace.trace_format).toBe(TRACE_FORMAT)
    expect(trace.app_version).toBe('1.12.99')
    expect(trace.captured_at).toBe(1_700_000_000_000)
    expect(JSON.parse(JSON.stringify(trace))).toEqual(trace)
  })
})
