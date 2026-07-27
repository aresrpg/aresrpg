// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// THE 'UNLIMITED' CAST SENTINEL — one fact, two readers (#1071).
//
// `casts_per_turn` / `casts_per_target` carry a magic value meaning "no cap". The AUTHORITY defines it: Move's
// `CASTS_UNLIMITED` (cast.move:57) is 255 and nothing else, and the sim's read twin (`fight_cast_limits.js`)
// mirrors it through `CASTS_UNLIMITED` from spell_templates.js. The CLIENT decoder (`draft_budget.js` `cap_of`)
// additionally reads an authored `0` as unlimited — and 0 is not a sentinel on chain, it is a cap of zero.
//
// The client therefore fails OPEN on an authored 0: it offers casts the chain refuses. Three readers ride
// `cap_of` today — `DeckCluster.jsx:208`, `DungeonBoard.jsx:319`, and (since 230f8fe6) the scripted fight bot at
// `bot/policy.js:213`, which makes the divergence a PARITY-ORACLE failure rather than a cosmetic HUD one: the
// bot drafts a cast the chain aborts, and the twin goes red with this sentinel as its root cause.
//
// This file is the shared oracle both readers must satisfy. The green tests below pin what the authority
// actually does for every authored cap in use today; the skipped test is #1071's definition of done and cannot
// go green without the production fix (one decoder both sides import, `cap_of` no longer treating 0 as 255).

import { describe, expect, test } from 'bun:test'

import { CASTS_UNLIMITED } from '../../sim/src/spell_templates.js'
import { check_cast_limits, record_cast } from '../../sim/src/fight_cast_limits.js'
import { cap_of } from '../src/draft_budget.js'

const CASTER = 'p0'
const SPELL = 'spell_a'
const TARGET = { x: 3, y: 3 }

/** An authored level carrying only the per-turn cap under test — no cooldown, no per-target cap. */
const level = (casts_per_turn) => ({
  cooldown_turns: 0,
  casts_per_turn,
  casts_per_target: CASTS_UNLIMITED,
})

/** THE AUTHORITY'S OWN ANSWER: drive the chain twin's read+write gate and report how many casts of one spell it
 *  accepts before refusing, plus the error it refuses with. `attempts` bounds the probe — an uncapped spell
 *  never refuses, so it reports `accepted === attempts` and the caller reads that as unbounded. */
const chain_accepts = (casts_per_turn, { state = { turn_number: 1 }, attempts = 6 } = {}) =>
  Array.from({ length: attempts }).reduce(
    (acc) => {
      if (acc.error) return acc
      const spell_level = level(casts_per_turn)
      const verdict = check_cast_limits(acc.state, CASTER, SPELL, spell_level, TARGET)
      if (!verdict.valid) return { ...acc, error: verdict.error }
      return {
        error: null,
        accepted: acc.accepted + 1,
        state: record_cast(acc.state, CASTER, SPELL, spell_level, TARGET),
      }
    },
    { accepted: 0, error: null, state }
  )

/** The authority's cap as a NUMBER, comparable with `cap_of`: unbounded within the probe → Infinity. */
const chain_cap_of = (casts_per_turn, options = {}) => {
  const attempts = options.attempts ?? 6
  const run = chain_accepts(casts_per_turn, { ...options, attempts })
  return run.error ? run.accepted : Infinity
}

describe('the chain twin — what the authority actually allows', () => {
  test('255 is THE unlimited sentinel: the gate never refuses, and never records a thing to refuse with', () => {
    const run = chain_accepts(CASTS_UNLIMITED)
    expect({ accepted: run.accepted, error: run.error }).toEqual({ accepted: 6, error: null })
    // an uncapped, cooldown-free spell is not tracked at all — `track_spell` is false, so no history accrues
    expect(run.state).toEqual({ turn_number: 1 })
  })

  test('a real cap passes through: N casts land, the N+1th aborts CASTS_PER_TURN', () => {
    expect(chain_accepts(3)).toMatchObject({ accepted: 3, error: 'CASTS_PER_TURN' })
    expect(chain_accepts(1)).toMatchObject({ accepted: 1, error: 'CASTS_PER_TURN' })
  })

  // THE LANDMINE, pinned as the authority's truth rather than argued about. An authored 0 is not "no cap": the
  // gate's own comparison is `casts_this_turn < casts_per_turn`, and with no record yet there is nothing to
  // compare, so the FIRST cast slips through — after which `0 < 0` and `1 < 0` are both false forever. The turn
  // rollover does not help: a new turn resets the counter to 0, and `0 < 0` still refuses.
  test('an authored 0 is a cap of zero: one cast lands, then the spell is dead — this turn and every turn after', () => {
    const first = chain_accepts(0, { attempts: 4 })
    expect(first).toMatchObject({ accepted: 1, error: 'CASTS_PER_TURN' })
    // …and next turn, with the counter rolled over, it refuses without accepting even one
    const next_turn = chain_accepts(0, { state: { ...first.state, turn_number: 2 }, attempts: 4 })
    expect(next_turn).toMatchObject({ accepted: 0, error: 'CASTS_PER_TURN' })
  })
})

describe('the client decoder agrees with the authority', () => {
  test('every authored cap the corpus uses today decodes to what the chain accepts', () => {
    for (const authored of [CASTS_UNLIMITED, 1, 3])
      expect({ authored, cap: cap_of(authored) }).toEqual({ authored, cap: chain_cap_of(authored) })
    // an ABSENT cap is a client-only shape (the chain always carries a u8) and stays Infinity by construction
    expect([cap_of(null), cap_of(undefined)]).toEqual([Infinity, Infinity])
  })

  // #1071 — THE DEFINITION OF DONE. Skipped because it cannot go green without the production fix: `cap_of`
  // (draft_budget.js:83-84) reads `authored === 0` as unlimited, so it returns Infinity where the chain accepts
  // exactly one cast. Un-skip when the two readers share one decoder; `draft_budget.test.js:136`
  // (`expect(cap_of(0)).toBe(Infinity)`) pins the divergent behaviour and flips in the same commit.
  test.skip("an authored 0 decodes to the chain's cap, not to unlimited (#1071)", () => {
    expect({ authored: 0, cap: cap_of(0) }).toEqual({ authored: 0, cap: chain_cap_of(0) })
  })
})
