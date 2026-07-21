// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RECORDER (issue #62 · R1) — the client black-box tap + ring buffer. Proves the three R1 invariants:
//   1. RING — entries beyond capacity evict oldest (seq monotonic, never reused).
//   2. DUMP — the capsule is deterministic and JSON-round-trips; a headerless buffer dumps null.
//   3. CAPTURE — a driven reduce() sequence (a real scripted trap fight, replay_gate conventions)
//      dumps the EXACT scenario inputs as a capsule that replays through the same door, and the
//      recorder's observed events + terminal version match a fresh replay byte-for-byte (parity).

import { describe, test, expect } from 'bun:test'

import {
  create_recorder,
  open_recording,
  observe_reduce,
  dump_capsule,
  DEFAULT_CAPACITY,
} from '../src/recorder.js'
import { reduce, create_fight_state } from '../src/reduce.js'
import { normalize_spell_templates } from '../src/spell_templates.js'
import { replay_capsule, revive_arena, digest } from '../src/timeline.js'

/** JSON round-trip so live values and dumped capsules compare identically (drops undefined keys). */
const jsonify = value => JSON.parse(JSON.stringify(value))

// ── Scenario atoms (copied from test/replay_gate.test.js — copy > abstract) ─────────────────────

const flat_arena_json = (width = 21) => ({
  width,
  height: width,
  cells: [...new Uint8Array(width * width)],
  spawns_a: [
    { x: 5, y: 5 },
    { x: 5, y: 6 },
  ],
  spawns_b: [{ x: 7, y: 5 }],
})

const trap_templates_raw = {
  yajin: {
    trap: {
      name: 'Trap',
      description: 'a hidden trap',
      levels: [
        {
          cost: 4,
          range: [1, 4],
          critical_chance: 0,
          area: 1,
          area_type: 'square',
          casts_per_turn: 255,
          casts_per_target: 255,
          cooldown_turns: 0,
          modifiable_range: true,
          line_of_sight: false,
          linear: false,
          free_cell: true,
          base_effects: [
            {
              type: 'damage',
              min: 5,
              max: 9,
              target: 'trap',
              element: 'earth',
              chance: 100,
            },
          ],
          critical_effects: [],
        },
      ],
    },
  },
}

const make_entity = (id, cell, is_player, overrides = {}) => ({
  id,
  name: id,
  cell,
  health: 100,
  health_max: 100,
  ap: 10,
  ap_max: 10,
  mp: 5,
  mp_max: 5,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: 'yajin',
  level: 1,
  stats: { agility: 0, intelligence: 0, range: 0, strength: 0 },
  effects: [],
  deck: is_player ? ['trap'] : [],
  hand: is_player ? [] : ['trap'],
  discard: [],
  spell_levels: { trap: 1 },
  ap_reserve: 0,
  ...overrides,
})

// p0 places a trap on its own path then walks across it; survives (the trap_path_truncation golden).
const scenario = {
  meta: { id: 'recorder_trap_walk', class: 'trap', authored: '2026-07-21' },
  arena: flat_arena_json(),
  templates_raw: trap_templates_raw,
  initial: {
    fight_id: 'capsule_recorder_trap_walk',
    arena_seed: 1,
    team0: [make_entity('p0', { x: 5, y: 5 }, true)],
    team1: [make_entity('m0', { x: 7, y: 5 }, false)],
  },
  commands: [
    { type: 'start' },
    { type: 'cast', entity_id: 'p0', spell_id: 'trap', target: { x: 6, y: 5 } },
    {
      type: 'move',
      entity_id: 'p0',
      path: [
        { x: 6, y: 5 },
        { x: 6, y: 6 },
      ],
    },
    { type: 'end_turn', entity_id: 'p0' },
  ],
}

/** Drive the real reducer over the scenario, taping every command at the edge. Returns the recorder. */
const drive_and_record = (capacity = DEFAULT_CAPACITY) => {
  const arena = revive_arena(scenario.arena)
  const ctx = {
    spell_templates: normalize_spell_templates(scenario.templates_raw),
    arena,
  }
  const initial = create_fight_state({
    fight_id: scenario.initial.fight_id,
    arena_seed: scenario.initial.arena_seed,
    arena_radius: arena.radius,
    arena,
    team0: scenario.initial.team0,
    team1: scenario.initial.team1,
  })
  const opened = open_recording(create_recorder(capacity), {
    fight_id: scenario.initial.fight_id,
    arena: scenario.arena,
    templates_raw: scenario.templates_raw,
    initial: scenario.initial,
    at: 0,
    meta: scenario.meta,
  })
  return scenario.commands.reduce(
    (acc, command, index) => {
      const { state, events } = reduce(acc.state, command, ctx)
      return {
        state,
        rec: observe_reduce(acc.rec, {
          fight_id: scenario.initial.fight_id,
          command,
          pre_state: acc.state,
          post_state: state,
          events,
          at: index + 1,
        }),
      }
    },
    { state: initial, rec: opened },
  ).rec
}

// ── 1. RING ──────────────────────────────────────────────────────────────────────────────────

describe('recorder ring buffer', () => {
  test('entries beyond capacity evict the oldest (seq monotonic)', () => {
    const filled = Array.from({ length: 6 }).reduce(
      (rec, _unused, i) =>
        observe_reduce(rec, {
          fight_id: 'f',
          command: { type: 'probe', i },
          pre_state: { n: i },
          post_state: { n: i + 1 },
          events: [],
          at: i,
        }),
      create_recorder(4),
    )
    expect(filled.entries.length).toBe(4)
    expect(filled.seq).toBe(6)
    // seq is never reused: the two oldest (0,1) are gone, the last four survive in order.
    expect(filled.entries.map(entry => entry.seq)).toEqual([2, 3, 4, 5])
    expect(filled.entries.every(entry => entry.kind === 'step')).toBe(true)
  })

  test('create_recorder guards a bad capacity to the default', () => {
    expect(create_recorder(0).capacity).toBe(DEFAULT_CAPACITY)
    expect(create_recorder(-5).capacity).toBe(DEFAULT_CAPACITY)
    expect(create_recorder(3.5).capacity).toBe(DEFAULT_CAPACITY)
    expect(create_recorder(7).capacity).toBe(7)
    expect(create_recorder().capacity).toBe(DEFAULT_CAPACITY)
  })
})

// ── 2. DUMP ──────────────────────────────────────────────────────────────────────────────────

describe('dump_capsule', () => {
  test('a headerless buffer dumps null (total, never throws)', () => {
    expect(dump_capsule(create_recorder())).toBe(null)
    // steps with no open recording -> nothing to dump.
    const steps_only = observe_reduce(create_recorder(), {
      fight_id: 'f',
      command: { type: 'start' },
      pre_state: { a: 1 },
      post_state: { a: 2 },
    })
    expect(dump_capsule(steps_only)).toBe(null)
  })

  test('an evicted header yields null rather than a broken capsule', () => {
    // capacity 2: the open (seq 0) is pushed out by the two steps -> not dumpable.
    const evicted = [1, 2].reduce(
      (rec, i) =>
        observe_reduce(rec, {
          fight_id: 'g',
          command: { type: 'probe', i },
          pre_state: { n: i },
          post_state: { n: i + 1 },
        }),
      open_recording(create_recorder(2), {
        fight_id: 'g',
        arena: flat_arena_json(3),
        templates_raw: {},
        initial: { fight_id: 'g', arena_seed: 1, team0: [], team1: [] },
      }),
    )
    expect(evicted.entries.some(entry => entry.kind === 'open')).toBe(false)
    expect(dump_capsule(evicted)).toBe(null)
  })

  test('the dump is deterministic and JSON-round-trips (source: sentry)', () => {
    const rec = drive_and_record()
    const first = dump_capsule(rec)
    const second = dump_capsule(rec)
    // deterministic: two dumps of the same buffer are byte-identical.
    expect(digest(first)).toBe(digest(second))
    // JSON-serializable: a round-trip changes nothing (no undefined, functions, or typed arrays).
    expect(JSON.parse(JSON.stringify(first))).toEqual(first)
    expect(first.meta.source).toBe('sentry')
    // caller meta wins (a capsule id is distinct from the runtime fight_id, as in replay_gate)...
    expect(first.meta.id).toBe(scenario.meta.id)
  })

  test('meta.id defaults to the fight_id when the caller supplies none', () => {
    const bare = open_recording(create_recorder(), {
      fight_id: 'fight-xyz',
      arena: flat_arena_json(3),
      templates_raw: {},
      initial: { fight_id: 'fight-xyz', arena_seed: 1, team0: [], team1: [] },
    })
    expect(dump_capsule(bare).meta.id).toBe('fight-xyz')
  })
})

// ── 3. CAPTURE — a driven reduce() sequence dumps the exact, replayable capsule ─────────────────

describe('driven reduce() -> replayable sentry capsule', () => {
  test('the tap captures the scripted fight as an exact, replayable capsule', () => {
    const rec = drive_and_record()
    const capsule = dump_capsule(rec)

    // (a) DRIFT — the dumped inputs are the scenario's inputs (replay_gate's own no-drift check).
    expect(
      digest({
        arena: capsule.arena,
        templates_raw: capsule.templates_raw,
        initial: capsule.initial,
        commands: capsule.commands,
      }),
    ).toBe(
      digest(
        jsonify({
          arena: scenario.arena,
          templates_raw: scenario.templates_raw,
          initial: scenario.initial,
          commands: scenario.commands,
        }),
      ),
    )
    expect(capsule.commands).toEqual(scenario.commands)

    // (b) REPLAYABLE — the captured capsule folds cleanly through the sim's replay harness.
    const replay = replay_capsule(capsule)
    expect(replay.violations).toEqual([])

    // (c) PARITY — the recorder's OBSERVED events + terminal version match a fresh replay exactly:
    // the black box recorded precisely what the reducer did (client/sim determinism, the whole point).
    const steps = rec.entries.filter(entry => entry.kind === 'step')
    expect(jsonify(steps.flatMap(entry => entry.events))).toEqual(
      jsonify(replay.events),
    )
    expect(steps.at(-1).post).toBe(digest(replay.terminal))
    // the trap fired: the walk was recorded and a trap-trigger event is in the stream.
    expect(
      replay.events.some(event => event.type === 'fight_trap_triggered'),
    ).toBe(true)
  })
})
