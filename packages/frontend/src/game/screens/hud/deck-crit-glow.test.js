// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// §7 turn-seed crit-glow predicate — pure-module tests (no component mount, no store mocks; deck-crit-glow.js
// imports only @aresrpg/sim). Composing the clock is NOT this module's job any more (#1190 — crit_clock_of in
// @aresrpg/fight owns it, tested in packages/fight/test/crit_clock_seat.test.js); these pin the ROLL.
// The clock tuple below is the SAME golden vector pinned by the sim's parity suite
// (packages/sim/test/turn_seed.test.js, tuple A), extracted from the REAL Move packages via a `sui move test`
// debug probe: (world_seed 123456789, spawn_id 42, turn_entropy 3141592653, turn_ordinal 7, seat 0) →
// turn_seed 2347341858, slot crit rolls [1089, 3920, 5988] — so these tests bind the UI predicate to on-chain
// truth, not to itself. The tuple moved when the turn seed stopped folding the wall-clock deadline and started
// folding the turn's own published entropy + ordinal (TurnStarted); the goldens moved with the Move fold.

import { describe, expect, it } from 'bun:test'

import { next_slot_crit, socket_glows, next_hit } from './deck-crit-glow.js'

const CLOCK = { world_seed: 123456789n, spawn_id: 42n, turn_entropy: 3141592653n, turn_ordinal: 7n, seat: 0 }
const at = (slot) => ({ ...CLOCK, slot })

describe('next_slot_crit — the roll for a composed clock slot', () => {
  it('derives the Move-golden crit roll for slot 0', () => {
    expect(next_slot_crit(at(0))).toEqual({ slot: 0, crit_roll: 1089 })
  })

  it('DRAFT-ADVANCE: each queued cast/weapon action moves the slot (the live-updating glow)', () => {
    expect(next_slot_crit(at(1))).toEqual({ slot: 1, crit_roll: 3920 })
    expect(next_slot_crit(at(2))).toEqual({ slot: 2, crit_roll: 5988 })
  })

  it('the roll is bound to the INDEX only — never to how the slot was reached', () => {
    // committed casts + local draft compose into one index upstream (crit_clock_of); 1+1 and 0+2 are one slot
    expect(next_slot_crit(at(2))).toEqual(next_slot_crit({ ...CLOCK, slot: 2 }))
  })

  it('an unknowable clock previews NOTHING — the null convention, composed once in crit_clock_of', () => {
    // off-turn, no roster row, an unstamped deadline, a seed-less Fight: every one of them arrives here as null
    // (@aresrpg/fight/predict_cast owns that judgement; its own suite pins each case).
    expect(next_slot_crit(null)).toBeNull()
  })
})

describe('socket_glows — the crit threshold (spell_formula::crit_at, crit_bonus 0 like the chain)', () => {
  it('threshold edges match the Move t_crit_at_bp_threshold vectors', () => {
    expect(socket_glows(4999, 2)).toBe(true) // 1-in-2 → threshold 5000
    expect(socket_glows(5000, 2)).toBe(false)
    expect(socket_glows(499, 20)).toBe(true) // 1-in-20 → threshold 500
    expect(socket_glows(500, 20)).toBe(false)
  })

  it('rate 0 NEVER glows (and a missing rate counts as 0)', () => {
    for (const roll of [0, 1, 1089, 9999]) expect(socket_glows(roll, 0)).toBe(false)
    expect(socket_glows(0, undefined)).toBe(false)
  })

  it('the golden slot-0 roll (2816) discriminates real seed rates: 1-in-2/3 glow, 1-in-4+ do not', () => {
    expect(socket_glows(2816, 2)).toBe(true) // threshold 5000
    expect(socket_glows(2816, 3)).toBe(true) // threshold 3333
    expect(socket_glows(2816, 4)).toBe(false) // threshold 2500
    expect(socket_glows(2816, 50)).toBe(false) // the seeded spells' 1-in-50 → threshold 200
  })
})

describe('next_hit — the tooltip value (identity damage: exactly the authored base)', () => {
  it('crit-swaps to the crit base while glowing, else the base — never any variance', () => {
    expect(next_hit(15, 25, false)).toBe(15) // the seeded DAMAGE base/crit_base pair
    expect(next_hit(15, 25, true)).toBe(25)
  })

  it('a row without a crit line honestly falls back to the base (heals like qa_minor_mend)', () => {
    expect(next_hit(15, null, true)).toBe(15)
    expect(next_hit(15, undefined, true)).toBe(15)
  })
})
