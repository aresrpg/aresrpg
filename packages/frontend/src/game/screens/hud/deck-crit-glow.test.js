// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// §7 turn-seed crit-glow predicate — pure-module tests (no component mount, no store mocks; deck-crit-glow.js
// imports only @aresrpg/sim). The fight tuple below is the SAME golden vector pinned by the sim's parity suite
// (packages/sim/test/turn_seed.test.js), extracted from the REAL Move packages via a `sui move test` debug
// probe: (world_seed 123456789, spawn_id 42, deadline 1752192000000, seat 0) → turn_seed 4190174188, slot crit
// rolls [2816, 4768, 1518] — so these tests bind the UI predicate to on-chain truth, not to itself.

import { describe, expect, it } from 'bun:test'

import { next_slot_crit, socket_glows, next_hit } from './deck-crit-glow.js'

const FIGHT = { world_seed: 123456789n, spawn_id: 42n, turn_deadline_ms: 1752192000000n, seat: 0 }
const ctx = (over = {}) => ({ my_turn: true, ...FIGHT, casts_this_turn: 0, draft_len: 0, ...over })

describe('next_slot_crit — the NEXT action slot preview', () => {
  it('derives the Move-golden crit roll for slot 0', () => {
    expect(next_slot_crit(ctx())).toEqual({ slot: 0, crit_roll: 2816 })
  })

  it('DRAFT-ADVANCE: each queued cast/weapon action moves the slot (the live-updating glow)', () => {
    expect(next_slot_crit(ctx({ draft_len: 1 }))).toEqual({ slot: 1, crit_roll: 4768 })
    expect(next_slot_crit(ctx({ draft_len: 2 }))).toEqual({ slot: 2, crit_roll: 1518 })
  })

  it('committed actions advance the slot identically (escrow casts_this_turn + draft compose)', () => {
    expect(next_slot_crit(ctx({ casts_this_turn: 1, draft_len: 1 }))).toEqual({ slot: 2, crit_roll: 1518 })
    // same slot index, same roll — the chain binds the roll to the INDEX, not to how it was reached
    expect(next_slot_crit(ctx({ casts_this_turn: 2 }))).toEqual(next_slot_crit(ctx({ draft_len: 2 })))
  })

  it('unknowable states preview NOTHING: off-turn, or any missing seed input', () => {
    expect(next_slot_crit(ctx({ my_turn: false }))).toBeNull()
    expect(next_slot_crit(ctx({ world_seed: null }))).toBeNull()
    expect(next_slot_crit(ctx({ spawn_id: null }))).toBeNull()
    expect(next_slot_crit(ctx({ turn_deadline_ms: null }))).toBeNull()
    expect(next_slot_crit(ctx({ seat: null }))).toBeNull()
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
    for (const roll of [0, 1, 2816, 9999]) expect(socket_glows(roll, 0)).toBe(false)
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
