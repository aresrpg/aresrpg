// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1190 — THE §7 CRIT CLOCK'S SEAT. `seat` is a participant INDEX; the two resolving cast paths used to compose
// it with `escrow.findIndex(...)`, whose miss value is -1. `chain_critical` rejected a MISSING seat and accepted
// that one, so a roster miss produced a well-formed seed for a seat that does not exist and a CONFIDENT crit
// branch off it — no shape difference from a right answer. The golden tuple below is the sim parity suite's own
// Move-extracted vector (packages/sim/test/turn_seed.test.js): (123456789, 42, 1752192000000, seat 0) →
// turn_seed 4190174188, slot rolls [2816, 4768, 1518].

import { describe, expect, it } from 'bun:test'
import { slot_crit_roll, turn_seed } from '@aresrpg/sim/turn_seed'

import { chain_critical, crit_clock_of } from '../src/predict_cast.js'

const CLOCK = { world_seed: 123456789n, spawn_id: 42n, turn_entropy: 3141592653n, turn_ordinal: 7n, slot: 0 }
const FIGHT = { world_seed: 123456789n, spawn_id: 42n, turn_entropy: 3141592653n, turn_ordinal: 7n }
// a board_state escrow row, trimmed to what the clock reads (board_state.js stamps `seat` = participant index)
const ROW = { seat: 0, casts_this_turn: 0, character: '0xc' }

describe('crit_clock_of — the ONE composer of the §7 clock (#1190)', () => {
  it('takes the seat off the row itself, never a lookup', () => {
    expect(crit_clock_of({ fight: FIGHT, seat_row: ROW })).toEqual({ ...FIGHT, seat: 0, slot: 0 })
    expect(crit_clock_of({ fight: FIGHT, seat_row: { ...ROW, seat: 3 } })?.seat).toBe(3)
  })

  it('the slot is my committed casts plus the local draft — composed once, for all four surfaces', () => {
    expect(crit_clock_of({ fight: FIGHT, seat_row: ROW, draft_len: 2 })?.slot).toBe(2)
    expect(crit_clock_of({ fight: FIGHT, seat_row: { ...ROW, casts_this_turn: 1 }, draft_len: 1 })?.slot).toBe(2)
    expect(crit_clock_of({ fight: FIGHT, seat_row: { ...ROW, casts_this_turn: 2 } })?.slot).toBe(2)
  })

  it('THE LIVE MISS: an empty/unlanded roster yields no row, and no row is null — never seat -1', () => {
    // both resolving cast paths used to run escrow.findIndex here; on the simulator's empty escrow that is -1
    expect(crit_clock_of({ fight: FIGHT, seat_row: null })).toBeNull()
    expect(crit_clock_of({ fight: FIGHT, seat_row: {} })).toBeNull()
    expect(crit_clock_of({ fight: FIGHT, seat_row: { seat: -1 } })).toBeNull()
  })

  it('every other unknowable input degrades to the SAME null, so the guard downstream is one rule', () => {
    expect(crit_clock_of({ fight: null, seat_row: ROW })).toBeNull()
    expect(crit_clock_of({ fight: { ...FIGHT, world_seed: null }, seat_row: ROW })).toBeNull()
    expect(crit_clock_of({ fight: { ...FIGHT, spawn_id: null }, seat_row: ROW })).toBeNull()
    // 0 is board_state's UNSTAMPED deadline (placement), not a seed input — the normalization lives here now
    expect(crit_clock_of({ fight: { ...FIGHT, turn_ordinal: 0 }, seat_row: ROW })).toBeNull()
  })

  it('a composed clock is exactly what chain_critical accepts — the two ends agree by construction', () => {
    expect(chain_critical(crit_clock_of({ fight: FIGHT, seat_row: ROW }), 2)).toBe(true)
    expect(chain_critical(crit_clock_of({ fight: FIGHT, seat_row: null }), 2)).toBeNull()
  })
})

describe('chain_critical — a NOT-FOUND seat is not a seat (#1190)', () => {
  it('a findIndex-miss seat (-1) is unknowable, exactly like a missing one', () => {
    expect(chain_critical({ ...CLOCK, seat: -1 }, 2)).toBeNull()
    expect(chain_critical({ ...CLOCK, seat: -1 }, 2)).toBe(chain_critical({ ...CLOCK, seat: null }, 2))
  })

  it('every negative index degrades the same way — the guard is on the sign, not on the literal -1', () => {
    expect(chain_critical({ ...CLOCK, seat: -2 }, 2)).toBeNull()
    expect(chain_critical({ ...CLOCK, seat: -1, slot: 2 }, 50)).toBeNull()
  })

  it('a REAL seat still answers — the guard narrows nothing legitimate', () => {
    // seat 0's slot-0 roll is 1089: a 1-in-2 spell (threshold 5000) crits, a 1-in-10 (1000) does not.
    expect(chain_critical({ ...CLOCK, seat: 0 }, 2)).toBe(true)
    expect(chain_critical({ ...CLOCK, seat: 0 }, 10)).toBe(false)
  })

  it('the leak was never benign: the -1 seed is a different sequence with a different verdict', () => {
    expect(turn_seed({ ...CLOCK, seat: -1 })).not.toBe(turn_seed({ ...CLOCK, seat: 0 }))
    // seat -1's slot-0 roll is 2378 — that same 1-in-10 spell reads as a CRIT off the phantom seat.
    expect(slot_crit_roll(turn_seed({ ...CLOCK, seat: -1 }), 0)).toBe(2378)
    expect(slot_crit_roll(turn_seed({ ...CLOCK, seat: 0 }), 0)).toBe(1089)
  })
})
