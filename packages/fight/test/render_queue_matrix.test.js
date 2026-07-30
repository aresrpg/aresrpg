// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, test, expect } from 'bun:test'

import { FIGHT_RENDER_TIMINGS, produce_receipt_render_turns } from '../src/fight_render_events.js'
import { MOB_TURN_MS, pace_segment } from '../src/present.js'

// ╔══════════════════════════════════════════════════════════════════════════════════════════════════╗
// ║ PILLAR 2b — RENDERER × MOCKED QUEUES                                                               ║
// ║                                                                                                    ║
// ║ NO BROWSER — the presentation cursor is a PURE function of an ordered event queue                  ║
// ║ (fight_render_events.produce_receipt_render_turns + present.pace_segment). This harness feeds      ║
// ║ SYNTHETIC chain-event queues covering EVERY receipt event kind across mob layouts and asserts each ║
// ║ yields its render beats with the correct KIND and TIMING slot, deterministically. It is the        ║
// ║ headless twin of the headed adaptive-fight row: the render path proven at unit cost, every effect. ║
// ╚══════════════════════════════════════════════════════════════════════════════════════════════════╝

const PKG = `0x${'a'.repeat(64)}`
const FIGHT = `0x${'b'.repeat(64)}`
// One raw chain event of `name` with `json` fields merged onto the fight id — the exact `{type,parsedJson}` shape
// the SDK's decode_fight_event consumes (numeric fields coerced to Number on decode).
const ev = (name, json) => ({ type: `${PKG}::fight_events::${name}`, parsedJson: { fight: FIGHT, ...json } })

const ctx = (extra = {}) => ({
  fight_id: FIGHT,
  grid_width: 20,
  resolve_fighter_id: ({ is_mob, idx, character }) => character ?? `${is_mob ? 'mob' : 'player'}-${idx}`,
  ...extra,
})

// Flatten a queue into its ordered render beats (unrescaled — raw kinds + base timings).
const beats_of = (events, extra = {}) => produce_receipt_render_turns(events, ctx(extra)).events
const kinds_of = (beats) => beats.map((b) => b.kind)
const first = (beats, kind) => beats.find((b) => b.kind === kind)

// ── THE EVENT → BEAT MATRIX: every receipt event kind → its render beat(s) + timing slot ─────────────
// Each row: a minimal LEGAL queue (a TurnStarted opens the actor's turn, then the event), the beat kinds it must
// yield, and per-beat timing assertions drawn from FIGHT_RENDER_TIMINGS (the renderer's semantic clock).
const T = FIGHT_RENDER_TIMINGS

const matrix = [
  {
    id: 'player Moved → move + arrival',
    queue: [
      ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: 9 }),
      ev('Moved', { character: 'player-0', to_cell: 41 }),
    ],
    expect: ['turn_start', 'move', 'arrival'],
    timings: { move: T.walk_cell, arrival: T.instant },
  },
  {
    id: 'MobMoved → move + arrival',
    queue: [ev('TurnStarted', { is_mob: true, idx: 0, deadline_ms: 9 }), ev('MobMoved', { idx: 0, to_cell: 42 })],
    expect: ['turn_start', 'move', 'arrival'],
    timings: { move: T.walk_cell, arrival: T.instant },
  },
  {
    id: 'Cast → cast',
    queue: [
      ev('TurnStarted', { is_mob: true, idx: 0, deadline_ms: 9 }),
      ev('Cast', { caster_is_mob: true, caster_idx: 0, target_cell: 3 }),
    ],
    expect: ['turn_start', 'cast'],
    timings: { cast: T.cast },
  },
  {
    id: 'Cast + Hit (survives) → cast + damage',
    queue: [
      ev('TurnStarted', { is_mob: true, idx: 0, deadline_ms: 9 }),
      ev('Cast', { caster_is_mob: true, caster_idx: 0, target_cell: 3 }),
      ev('Hit', { victim_is_mob: false, victim_idx: 0, amount: 7, remaining_hp: 33 }),
    ],
    expect: ['turn_start', 'cast', 'damage'],
    timings: { cast: T.cast, damage: T.damage },
    check: (beats) => expect(first(beats, 'damage').payload.damage).toBe(7),
  },
  {
    // #170 (5th recurrence): no separate 'death' beat anymore — a lethal Hit is still ONE 'damage' beat, now
    // carrying `killed: true` as cause enrichment. The presenter (voxel_fight_adapter.observe_death) derives the
    // actual death visual from the presented-state alive→dead edge, never from an event-shaped beat.
    id: 'Cast + lethal Hit → cast + damage (killed)',
    queue: [
      ev('TurnStarted', { is_mob: true, idx: 0, deadline_ms: 9 }),
      ev('Cast', { caster_is_mob: true, caster_idx: 0, target_cell: 3 }),
      ev('Hit', { victim_is_mob: false, victim_idx: 0, amount: 40, remaining_hp: 0 }),
    ],
    expect: ['turn_start', 'cast', 'damage'],
    timings: { cast: T.cast, damage: T.damage },
    check: (beats) => {
      const damage = first(beats, 'damage')
      expect(damage.payload.killed).toBe(true)
      expect(damage.payload.target_id).toBe('player-0')
    },
  },
  {
    id: 'Cast + Displaced → cast + displacement',
    queue: [
      ev('TurnStarted', { is_mob: true, idx: 0, deadline_ms: 9 }),
      ev('Cast', { caster_is_mob: true, caster_idx: 0, target_cell: 3 }),
      ev('Displaced', {
        target_is_mob: false,
        target_idx: 0,
        kind: 12,
        from_cell: 83,
        to_cell: 84,
        requested: 2,
        blocked: 0,
      }),
    ],
    expect: ['turn_start', 'cast', 'displacement'],
    timings: { displacement: T.displacement_cell }, // adjacent from→to = 1 cell of slide
    check: (beats) => {
      expect(first(beats, 'displacement').payload.target_id).toBe('player-0')
      // A PURE push (no Hit) must render a displacement beat and NO damage beat: a pushed mob showing a floating
      // damage number (the phantom float bug) can never originate from a bare displacement.
      expect(
        beats.some((b) => b.kind === 'damage'),
        'a pure push must not emit a damage/float beat'
      ).toBe(false)
    },
  },
  {
    id: 'Displaced onto a trap cell → displacement + trap_trigger',
    queue: [
      ev('TurnStarted', { is_mob: true, idx: 0, deadline_ms: 9 }),
      ev('Cast', { caster_is_mob: true, caster_idx: 0, target_cell: 3 }),
      ev('Displaced', {
        target_is_mob: false,
        target_idx: 0,
        kind: 12,
        from_cell: 83,
        to_cell: 84,
        requested: 2,
        blocked: 0,
      }),
      ev('Hit', { victim_is_mob: false, victim_idx: 0, amount: 5, remaining_hp: 30 }),
    ],
    extra: { trap_cells: [84] },
    expect: ['turn_start', 'cast', 'displacement', 'trap_trigger', 'damage'],
    timings: { trap_trigger: T.trap },
  },
  {
    id: 'Drain → status(DRAIN)',
    queue: [
      ev('TurnStarted', { is_mob: true, idx: 0, deadline_ms: 9 }),
      ev('Cast', { caster_is_mob: true, caster_idx: 0, target_cell: 3 }),
      ev('Drain', { target_is_mob: false, target_idx: 0 }),
    ],
    expect: ['turn_start', 'cast', 'status'],
    timings: { status: T.instant },
    check: (beats) => expect(first(beats, 'status').payload.status).toBe('DRAIN'),
  },
  {
    id: 'StanceChanged → status(STANCE)',
    queue: [
      ev('TurnStarted', { is_mob: true, idx: 0, deadline_ms: 9 }),
      ev('Cast', { caster_is_mob: true, caster_idx: 0, target_cell: 3 }),
      ev('StanceChanged', { target_is_mob: true, target_idx: 0 }),
    ],
    expect: ['turn_start', 'cast', 'status'],
    timings: { status: T.instant },
    check: (beats) => expect(first(beats, 'status').payload.status).toBe('STANCE'),
  },
  {
    id: 'TurnEnded → turn_end',
    queue: [ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: 9 }), ev('TurnEnded', { is_mob: false, idx: 0 })],
    expect: ['turn_start', 'turn_end'],
    timings: { turn_end: T.instant },
  },
  {
    id: 'Victory → fight_end',
    queue: [ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: 9 }), ev('Victory', {})],
    expect: ['turn_start', 'fight_end'],
    timings: { fight_end: T.instant },
    check: (beats) => expect(first(beats, 'fight_end').payload.outcome).toBe('Victory'),
  },
  {
    id: 'Defeat → fight_end',
    queue: [ev('TurnStarted', { is_mob: true, idx: 0, deadline_ms: 9 }), ev('Defeat', {})],
    expect: ['turn_start', 'fight_end'],
    timings: { fight_end: T.instant },
    check: (beats) => expect(first(beats, 'fight_end').payload.outcome).toBe('Defeat'),
  },
]

// The render beat KINDS the producer can emit (the render vocabulary) — the coverage universe for the gate below.
// #170 (5th recurrence): 'death' is no longer a beat kind the producer emits — the presenter derives the death
// visual from the presented-state edge (a 'damage' beat carrying `killed: true`), never an event-shaped beat.
const ALL_BEAT_KINDS = [
  'turn_start',
  'turn_end',
  'move',
  'arrival',
  'cast',
  'damage',
  'displacement',
  'trap_trigger',
  'status',
  'fight_end',
]

describe('PILLAR 2b — every receipt event kind renders to correct beats + timing, deterministically', () => {
  for (const row of matrix) {
    test(row.id, () => {
      const beats = beats_of(row.queue, row.extra ?? {})
      const kinds = kinds_of(beats)
      // (1) EXECUTES — every expected beat kind is present, in the asserted causal order (subsequence match).
      let cursor = 0
      for (const kind of row.expect) {
        const at = kinds.indexOf(kind, cursor)
        expect(
          at,
          `${row.id}: expected beat "${kind}" after position ${cursor}, got ${kinds.join(',')}`
        ).toBeGreaterThanOrEqual(cursor)
        cursor = at + 1
      }
      // (2) TIMING SLOT — each named beat carries its FIGHT_RENDER_TIMINGS duration.
      for (const [kind, duration] of Object.entries(row.timings ?? {}))
        expect(first(beats, kind).duration, `${row.id}: ${kind} beat duration`).toBe(duration)
      // (3) DETERMINISTIC — same queue folded twice → byte-identical beat stream.
      expect(JSON.stringify(beats_of(row.queue, row.extra ?? {}))).toBe(JSON.stringify(beats))
      row.check?.(beats)
    })
  }

  // ── LAYOUT FAN: the SAME per-mob action (move+cast+hit) across 1/3/6-mob waves paces at 3s/mob ───────
  const mob_turn = (i) => [
    ev('TurnStarted', { is_mob: true, idx: i, deadline_ms: 9 }),
    ev('MobMoved', { idx: i, to_cell: 40 + i }),
    ev('Cast', { caster_is_mob: true, caster_idx: i, target_cell: 3 }),
    ev('Hit', { victim_is_mob: false, victim_idx: 0, amount: 1, remaining_hp: 40 - i }),
    ev('TurnEnded', { is_mob: true, idx: i }),
  ]
  const is_local = (turn) => turn.source_id.startsWith('player')

  for (const mob_count of [1, 3, 6]) {
    test(`${mob_count}-mob wave paces at ${MOB_TURN_MS}ms/mob and renders every mob's beats`, () => {
      const queue = Array.from({ length: mob_count }, (_, i) => mob_turn(i)).flat()
      const paced = pace_segment(queue, ctx(), { is_local })
      // Exactly one presented turn per mob, each a readable ~3s slot; wave total = mob_count × 3s.
      const mob_turns = paced.turns.filter((t) => !t.is_local)
      expect(mob_turns.length).toBe(mob_count)
      expect(paced.total_duration).toBe(mob_count * MOB_TURN_MS)
      for (const turn of mob_turns) {
        expect(turn.duration).toBe(MOB_TURN_MS)
        // Each mob's slot carries its move + cast + damage beats (the "it executes properly" per-mob proof).
        const kinds = kinds_of(turn.beats)
        for (const kind of ['move', 'cast', 'damage']) expect(kinds).toContain(kind)
      }
      // Determinism across the whole paced wave.
      expect(JSON.stringify(pace_segment(queue, ctx(), { is_local }))).toBe(JSON.stringify(paced))
    })
  }

  test('a LOCAL (my own) turn presents instantly — 0ms slot (prediction plays this frame)', () => {
    const queue = [
      ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: 9 }),
      ev('Moved', { character: 'player-0', to_cell: 41 }),
      ev('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: 5 }),
      ev('TurnEnded', { is_mob: false, idx: 0 }),
    ]
    const paced = pace_segment(queue, ctx(), { is_local })
    const local = paced.turns.find((t) => t.is_local)
    expect(local, 'my player turn must be classified local').toBeTruthy()
    expect(local.duration).toBe(0)
    for (const beat of local.beats) expect(beat.duration).toBe(0)
  })

  // ── THE COVERAGE GATE: every render beat KIND the producer can emit is exercised by the matrix ───────
  test('COVERAGE — every render beat kind is exercised by the queue matrix', () => {
    const seen = new Set()
    for (const row of matrix) for (const b of beats_of(row.queue, row.extra ?? {})) seen.add(b.kind)
    // The layout-fan waves add nothing new, but include them so the universe reflects the whole harness.
    for (const b of beats_of(mob_turn(0))) seen.add(b.kind)
    const missing = ALL_BEAT_KINDS.filter((k) => !seen.has(k))
    expect(missing, `render beat kinds NOT exercised by any matrix row: ${missing.join(', ')}`).toEqual([])
  })
})
