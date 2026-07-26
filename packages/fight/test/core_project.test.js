// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// §④ PROJECTIONS unit truth (Fight V2 build step 2). The clock-driven cursor, the coalesce/snap past max_lag, and
// the legality predicate the starve property leans on. Beats advance by CLOCK ONLY — never an animation ack.

import { describe, test, expect } from 'bun:test'

import { empty_core_state, ingest } from '../src/core.js'
import {
  advance_cursor,
  present_cursor,
  is_legal_board,
  beat_queue,
  project_board,
  project_presentation,
  PACING_POLICY,
} from '../src/core_project.js'

const opened = () =>
  ingest(empty_core_state(), {
    payload: { kind: 'session_opened', fight_id: '0xf', my_key: null, ctx: {} },
    observed_at_ms: 0,
  })

/** Seed a base + a tail of N hits so there is a real beat queue to pace. */
const with_tail = (n) => {
  const fight = {
    width: 12,
    height: 12,
    status: 1,
    participants: [{ character: '0xa', cell: '5', hp: '70', ap: '6', mp: '3' }],
    mobs: [{ cell: '9', hp: '80' }],
  }
  let state = ingest(opened(), {
    payload: { kind: 'journal_rows_received', source: 'snapshot', fight_id: '0xf', version: 100, rows: fight },
    observed_at_ms: 1,
  })
  const events = Array.from({ length: n }, (_, i) => ({
    type: '0x0::fight_events::Hit',
    parsedJson: { fight: '0xf', victim_is_mob: true, victim_idx: 0, remaining_hp: 80 - i },
  }))
  state = ingest(state, {
    payload: { kind: 'journal_rows_received', source: 'receipt', fight_id: '0xf', version: 200, rows: { events } },
    observed_at_ms: 2,
  })
  return state
}

describe('advance_cursor — the clock is the ONLY cursor driver', () => {
  test('the cursor advances by floor(elapsed / beat_ms)', () => {
    const c0 = { now_ms: 1000, cursor: 0 }
    const c1 = advance_cursor(c0, 1000 + PACING_POLICY.beat_ms * 3, 100)
    expect(c1.cursor).toBe(3)
  })
  test('the first tick only sets the clock (no phantom advance from now_ms=0)', () => {
    expect(advance_cursor({ now_ms: 0, cursor: 0 }, 999999, 100).cursor).toBe(0)
  })
  test('the cursor never exceeds the beat count', () => {
    expect(advance_cursor({ now_ms: 0, cursor: 0 }, 0, 5).cursor).toBeLessThanOrEqual(5)
  })
})

describe('present_cursor — coalesce/snap past max_lag (the starve rule)', () => {
  test('within max_lag the cursor is honoured verbatim', () => {
    expect(present_cursor(10, 4, PACING_POLICY)).toBe(4)
  })
  test('past max_lag the eye snaps to within snap_to of the frontier (never falls unboundedly behind)', () => {
    const beats = 500
    expect(present_cursor(beats, 0, PACING_POLICY)).toBe(beats - PACING_POLICY.snap_to)
  })
  test('the raw cursor is clamped to [0, beats]', () => {
    expect(present_cursor(10, 99, PACING_POLICY)).toBe(10)
    expect(present_cursor(10, -5, PACING_POLICY)).toBe(0)
  })
})

describe('is_legal_board — the starve coherence predicate', () => {
  test('a well-formed active board is legal', () => {
    expect(is_legal_board({ phase: 'active', winner: -1, fighters: { p0: { cell: 5, hp: 70, alive: true } } })).toBe(
      true
    )
  })
  test('a corpse that is still alive is ILLEGAL (the resurrection guard)', () => {
    expect(is_legal_board({ phase: 'active', winner: -1, fighters: { p0: { cell: 5, hp: 0, alive: true } } })).toBe(
      false
    )
  })
  test('NaN / negative hp is illegal', () => {
    expect(is_legal_board({ phase: 'active', winner: -1, fighters: { p0: { cell: 5, hp: -3, alive: false } } })).toBe(
      false
    )
  })
  test('an unknown phase is illegal', () => {
    expect(is_legal_board({ phase: 'loading', winner: -1, fighters: {} })).toBe(false)
  })
})

describe('the starve state renders legal — truth-frontier ≫ presentation-cursor', () => {
  test('with a long tail and the cursor at 0, the presented board is still a legal prefix fold', () => {
    const state = with_tail(40)
    expect(beat_queue(state.inbox).length).toBe(40)
    const starved = { ...state, clock: { now_ms: 0, cursor: 0 } }
    const presented = project_presentation(starved)
    expect(is_legal_board(presented)).toBe(true)
    // truth (committed board) is fully folded regardless of where the eye sits
    expect(is_legal_board(project_board(state))).toBe(true)
  })

  test('clock ticks advance the eye without any render ack (beats-by-clock)', () => {
    let state = with_tail(20)
    state = ingest(state, { payload: { kind: 'clock_observed' }, observed_at_ms: 1000 })
    state = ingest(state, { payload: { kind: 'clock_observed' }, observed_at_ms: 1000 + PACING_POLICY.beat_ms * 5 })
    expect(state.clock.cursor).toBe(5) // five beats of wall-time elapsed → five beats presented
  })
})
