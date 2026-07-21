// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// TRIPWIRES (issue #63 · R2) — the physics invariants that run live over the recorded timeline in
// every client. Each law is proven BOTH ways: a scripted violating transition trips exactly it and
// names the implicated entities; a legal transition stays silent. Then the NO-FALSE-POSITIVE proof
// drives the REAL reducer over the whole committed capsule corpus through the checked tap and asserts
// ZERO violations — the reducer is pure, so a live trip is a bug or a rules change, never noise.

import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, test, expect } from 'bun:test'

import {
  check_tripwires,
  PHYSICS_INVARIANTS,
  revive_arena,
  digest,
} from '../src/timeline.js'
import {
  create_recorder,
  open_recording,
  observe_reduce_checked,
} from '../src/recorder.js'
import { reduce, create_fight_state } from '../src/reduce.js'
import { normalize_spell_templates } from '../src/spell_templates.js'

// ── Minimal state atoms — the invariants read only id/health/health_max/cell + team0/team1/winner ──
const ent = (id, health, cell, health_max = 100) => ({
  id,
  health,
  health_max,
  cell,
})
const st = (team0, team1 = [], winner = -1) => ({ team0, team1, winner })
const CMD = { type: 'probe' }
const CAUSE = [{ type: 'some_event' }] // a non-empty event stream: the change is "named"

/** the rule ids present in a check_tripwires result. */
const rules = violations => violations.map(violation => violation.rule)

// ── 1. Each invariant BOTH ways (the red/green pair per law) ─────────────────────────────────────

describe('PHYSICS_INVARIANTS — each law trips on breach, stays silent when honored', () => {
  test('the set is exactly the five issue #63 classes, in order', () => {
    expect(PHYSICS_INVARIANTS.map(invariant => invariant.id)).toEqual([
      'dead_stays_dead',
      'hp_bounds',
      'occupancy_exclusive',
      'winner_terminal',
      'change_has_cause',
    ])
  })

  test('dead_stays_dead: a corpse re-entering alive trips (named); staying dead is silent', () => {
    const dead = st([ent('a', 0, { x: 1, y: 1 })])
    const trip = check_tripwires(
      dead,
      st([ent('a', 12, { x: 1, y: 1 })]),
      CMD,
      CAUSE,
    )
    expect(rules(trip)).toContain('dead_stays_dead')
    expect(trip.find(v => v.rule === 'dead_stays_dead').entities).toEqual(['a'])
    // legal: still dead next tick.
    expect(
      check_tripwires(dead, st([ent('a', 0, { x: 1, y: 1 })]), CMD, CAUSE),
    ).toEqual([])
  })

  test('hp_bounds: health above max or below zero trips (named); in-range is silent', () => {
    const ok = st([ent('a', 50, { x: 1, y: 1 })])
    const over = check_tripwires(
      ok,
      st([ent('a', 150, { x: 1, y: 1 })]),
      CMD,
      CAUSE,
    )
    expect(rules(over)).toContain('hp_bounds')
    expect(over.find(v => v.rule === 'hp_bounds').entities).toEqual(['a'])
    expect(
      rules(
        check_tripwires(ok, st([ent('a', -3, { x: 1, y: 1 })]), CMD, CAUSE),
      ),
    ).toContain('hp_bounds')
    // legal: exactly at the max.
    expect(
      check_tripwires(ok, st([ent('a', 100, { x: 1, y: 1 })]), CMD, CAUSE),
    ).toEqual([])
  })

  test('occupancy_exclusive: two living actors on one cell trips (both named); corpses do not', () => {
    const prev = st(
      [ent('a', 100, { x: 1, y: 1 })],
      [ent('b', 100, { x: 9, y: 9 })],
    )
    const clash = st(
      [ent('a', 100, { x: 4, y: 4 })],
      [ent('b', 100, { x: 4, y: 4 })],
    )
    const trip = check_tripwires(prev, clash, CMD, CAUSE)
    expect(rules(trip)).toContain('occupancy_exclusive')
    expect(
      trip.find(v => v.rule === 'occupancy_exclusive').entities.sort(),
    ).toEqual(['a', 'b'])
    // legal: a DEAD actor sharing a cell is fine — corpses do not occupy.
    const corpse = st(
      [ent('a', 100, { x: 4, y: 4 })],
      [ent('b', 0, { x: 4, y: 4 })],
    )
    expect(rules(check_tripwires(prev, corpse, CMD, CAUSE))).not.toContain(
      'occupancy_exclusive',
    )
  })

  test('winner_terminal: a decided winner changing trips; the first conclusion is silent', () => {
    expect(
      rules(check_tripwires(st([], [], 0), st([], [], 1), CMD, CAUSE)),
    ).toContain('winner_terminal')
    // legal: -1 -> 0 is the conclusion itself, not a change of a settled result.
    expect(check_tripwires(st([], [], -1), st([], [], 0), CMD, CAUSE)).toEqual(
      [],
    )
    // legal: the winner holds.
    expect(check_tripwires(st([], [], 0), st([], [], 0), CMD, CAUSE)).toEqual(
      [],
    )
  })

  test('change_has_cause: an unexplained state change trips; a named change / no change is silent', () => {
    const before = st([ent('a', 100, { x: 1, y: 1 })])
    const after = st([ent('a', 60, { x: 1, y: 1 })]) // 40hp gone, still in-bounds & alive
    // no event names the drop -> the master rule fires, and ONLY it.
    expect(rules(check_tripwires(before, after, CMD, []))).toEqual([
      'change_has_cause',
    ])
    // same change, but an event names it -> silent.
    expect(check_tripwires(before, after, CMD, CAUSE)).toEqual([])
    // no change, no event -> silent.
    expect(
      check_tripwires(before, st([ent('a', 100, { x: 1, y: 1 })]), CMD, []),
    ).toEqual([])
  })

  test('a violation record carries the rule, the entities, and a transition-evidence digest', () => {
    const [trip] = check_tripwires(
      st([ent('a', 0, { x: 1, y: 1 })]),
      st([ent('a', 5, { x: 1, y: 1 })]),
      CMD,
      CAUSE,
    )
    expect(trip.rule).toBe('dead_stays_dead')
    expect(trip.entities).toEqual(['a'])
    // evidence fingerprints the causing transition (command + events) for the R4 capsule snip.
    expect(trip.evidence).toBe(digest({ command: CMD, events: CAUSE }))
  })
})

// ── 2. The live checked tap — the laws run at R1's reduce edge, zero false positives ─────────────

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'replay',
)

/** Drive a committed capsule through the REAL reducer, taping every step with the CHECKED tap. */
const drive_checked = capsule => {
  const arena = revive_arena(capsule.arena)
  const ctx = {
    spell_templates: normalize_spell_templates(capsule.templates_raw),
    arena,
  }
  const initial = create_fight_state({
    fight_id: capsule.initial.fight_id,
    arena_seed: capsule.initial.arena_seed,
    arena_radius: arena.radius,
    arena,
    team0: capsule.initial.team0,
    team1: capsule.initial.team1,
  })
  const opened = open_recording(create_recorder(), {
    fight_id: capsule.initial.fight_id,
    arena: capsule.arena,
    templates_raw: capsule.templates_raw,
    initial: capsule.initial,
    meta: capsule.meta,
  })
  return capsule.commands.reduce(
    (acc, command, index) => {
      const { state, events } = reduce(acc.state, command, ctx)
      const { rec, violations } = observe_reduce_checked(acc.rec, {
        fight_id: capsule.initial.fight_id,
        command,
        pre_state: acc.state,
        post_state: state,
        events,
        at: index + 1,
      })
      return { state, rec, violations: [...acc.violations, ...violations] }
    },
    { state: initial, rec: opened, violations: [] },
  )
}

const corpus = readdirSync(FIXTURES).filter(file => file.endsWith('.json'))

describe("observe_reduce_checked — the laws run live at R1's tap edge", () => {
  test('the whole committed capsule corpus drives with ZERO violations (no false positives)', () => {
    expect(corpus.length).toBeGreaterThan(0)
    for (const file of corpus) {
      const capsule = JSON.parse(readFileSync(join(FIXTURES, file), 'utf8'))
      const driven = drive_checked(capsule)
      // name the file in the assertion so a future red points straight at the offending capsule.
      expect({ file, violations: driven.violations }).toEqual({
        file,
        violations: [],
      })
      // the observer never suppresses the black box: every step is still recorded.
      const steps = driven.rec.entries.filter(entry => entry.kind === 'step')
      expect(steps.length).toBe(capsule.commands.length)
    }
  })

  test('a scripted breach at the edge surfaces the violation AND still records the step', () => {
    const pre = st([ent('a', 0, { x: 2, y: 2 })])
    const post = st([ent('a', 30, { x: 2, y: 2 })]) // a corpse rises: dead_stays_dead
    const { rec, violations } = observe_reduce_checked(create_recorder(), {
      fight_id: 'f',
      command: { type: 'cast' },
      pre_state: pre,
      post_state: post,
      events: [{ type: 'x' }],
      at: 1,
    })
    expect(rules(violations)).toContain('dead_stays_dead')
    // TOTAL: the observer never throws and never drops the recording.
    expect(rec.entries.length).toBe(1)
    expect(rec.entries[0].kind).toBe('step')
  })
})
