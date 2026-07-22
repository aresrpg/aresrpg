// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// TWIN COHERENCE (Fight V2 step 0, fable's CI-pinned property): for every command, the OBSERVABLE projection of
// `reduce(state, command, ctx).state` must equal folding that command's OWN emitted events through
// `apply_canonical_event` from the same observable base. This is the deterministic twin stated at the seam: the
// command reducer (prediction) and the event fold (authoritative truth) are the SAME observable math, so the
// sim's emitted event log is a COMPLETE description of the observable state change — the premise the whole V2
// input-log-is-the-state core rides on. Driven over the EXISTING replay-gate capsules (real authored fights).
//
// A red here is a real finding, not noise: an emitted event that does NOT carry enough to reconstruct the
// observable delta it caused (reported with the exact command + fighter + field), OR a genuine twin divergence.

import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, test, expect } from 'bun:test'

import { reduce, create_fight_state } from '../src/reduce.js'
import { revive_arena } from '../src/timeline.js'
import { normalize_spell_templates } from '../src/spell_templates.js'
import {
  apply_canonical_event,
  project_observable,
  hash_state,
  empty_observable,
  EVOLVE_VERSION,
} from '../src/evolve.js'

const FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'replay',
)

/** JSON round-trip so live cell/effect values compare identically to parsed-fixture shapes (drops undefined). */
const jsonify = value => JSON.parse(JSON.stringify(value))

/** Rebuild a capsule's reducer context + initial state exactly as the replay gate does. */
const boot = capsule => {
  const arena = revive_arena(capsule.arena)
  const ctx = {
    spell_templates: normalize_spell_templates(capsule.templates_raw),
    arena,
  }
  const state = create_fight_state({
    fight_id: capsule.initial.fight_id,
    arena_seed: capsule.initial.arena_seed,
    arena_radius: arena.radius,
    arena,
    team0: capsule.initial.team0,
    team1: capsule.initial.team1,
  })
  return { ctx, state }
}

/** Fold one command's events through the evolver, surfacing any refusal as DATA (never a throw). */
const fold_events = (observable, events) =>
  events.reduce(
    (acc, event) => {
      if (acc.failure) return acc
      const result = apply_canonical_event(acc.state, jsonify(event))
      if (result.kind === 'sim_failure') return { ...acc, failure: result }
      return { state: result.state, failure: null }
    },
    {
      state: observable,
      failure: /** @type {null | Record<string, unknown>} */ (null),
    },
  )

const fixtures = readdirSync(FIXTURES_DIR).filter(name =>
  name.endsWith('.json'),
)

describe('twin coherence — reduce(state,cmd) ≡ fold of its own events via apply_canonical_event', () => {
  test('the seam version is pinned', () => {
    expect(EVOLVE_VERSION).toBe(1)
  })

  for (const file of fixtures) {
    test(`observable coherence over ${file}`, () => {
      const capsule = JSON.parse(readFileSync(join(FIXTURES_DIR, file), 'utf8'))
      const { ctx, state: initial } = boot(capsule)

      let state = initial
      // Per-command: fold the command's OWN emitted events onto the observable base, and require the result to
      // equal the observable projection of the reducer's post-command state — localized so a red names its command.
      capsule.commands.forEach((command, index) => {
        const before = project_observable(state)
        const { state: after, events } = reduce(state, command, ctx)
        const expected = project_observable(after)
        const folded = fold_events(before, events)

        expect(
          folded.failure,
          `${file} cmd#${index} (${command.type}): apply_canonical_event refused an emitted event → ${JSON.stringify(folded.failure)}`,
        ).toBeNull()
        expect(
          jsonify(folded.state),
          `${file} cmd#${index} (${command.type}): folded observable ≠ reducer observable (emitted events do not fully reconstruct the observable delta)`,
        ).toEqual(jsonify(expected))

        state = after
      })
    })
  }

  test('whole-stream fold over the initial roster reaches the same terminal observable as the reducer', () => {
    // The stronger V2 statement (snapshot base + event tail = truth): from the INITIAL roster projection, the
    // ENTIRE emitted event log — folded continuously WITHOUT re-syncing between commands — reconstructs the terminal
    // observable board (positions · health · liveness · winner) the reducer computed. Seeding from the roster (not
    // an empty state) is honest and load-bearing: the sim's placement events carry only a CELL, never a fighter's
    // health, so initial vitals come from the roster snapshot — exactly the V2 "boot IS catch-up" base+tail model.
    const capsule = JSON.parse(
      readFileSync(join(FIXTURES_DIR, 'trap_path_truncation.json'), 'utf8'),
    )
    const { ctx, state: initial } = boot(capsule)

    let reducer_state = initial
    let observable = project_observable(initial)

    for (const command of capsule.commands) {
      const { state: after, events } = reduce(reducer_state, command, ctx)
      for (const event of events) {
        const result = apply_canonical_event(observable, jsonify(event))
        expect(
          result.kind,
          `emitted event refused: ${JSON.stringify(event)}`,
        ).not.toBe('sim_failure')
        observable = /** @type {{ state: any }} */ (result).state
      }
      reducer_state = after
    }
    expect(jsonify(observable)).toEqual(
      jsonify(project_observable(reducer_state)),
    )
  })
})

describe('apply_canonical_event — failure is DATA, never a throw', () => {
  test('an unrecognized event type returns a sim_failure record', () => {
    const result = apply_canonical_event(empty_observable(), {
      type: 'not_a_real_event',
    })
    expect(result).toMatchObject({
      kind: 'sim_failure',
      reason: expect.stringContaining('not_a_real_event'),
    })
  })

  test('a typeless event returns a sim_failure record (no throw)', () => {
    const result = apply_canonical_event(empty_observable(), {})
    expect(result.kind).toBe('sim_failure')
  })
})

describe('hash_state — deterministic, stable-key-order content hash', () => {
  const sample = () => ({
    fighters: {
      p0: { id: 'p0', cell: { x: 1, y: 2 }, health: 40, alive: true },
    },
    active_id: 'p0',
    winner: -1,
  })

  test('same content → same hash', () => {
    expect(hash_state(sample())).toBe(hash_state(sample()))
  })

  test('key insertion order does not change the hash (stable key order)', () => {
    const reordered = {
      winner: -1,
      active_id: 'p0',
      fighters: {
        p0: { alive: true, health: 40, id: 'p0', cell: { y: 2, x: 1 } },
      },
    }
    expect(hash_state(reordered)).toBe(hash_state(sample()))
  })

  test('a content change changes the hash', () => {
    const hurt = sample()
    hurt.fighters.p0.health = 39
    expect(hash_state(hurt)).not.toBe(hash_state(sample()))
  })
})
