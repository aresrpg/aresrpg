// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2154 — the join's click→seat-visible trace. `engage_timing.js` was the ONLY perf mark in the whole flow, so
// the join's 4s was reported rather than measured. These tests pin what the instrument must guarantee: it closes
// only on the fight it was opened for (an unrelated concurrent entry cannot fabricate a fast number), it is
// inert without a live trace, and the durations it returns are the three legs the row's DoD asks for.

import { describe, expect, test } from 'bun:test'

import {
  cancel_join_timing,
  finish_join_timing,
  join_timing_fight_id,
  mark_join_receipt,
  start_join_timing,
  JOIN_MARK_NAMES,
  JOIN_MEASURE_NAMES,
} from '../../src/core/join_timing.js'

const FIGHT = '0xfight'

describe('join_timing', () => {
  test('closes the three legs of the join it was opened for', () => {
    start_join_timing(FIGHT, 'test')
    expect(join_timing_fight_id()).toBe(FIGHT)
    mark_join_receipt(FIGHT)
    const durations = finish_join_timing(FIGHT)
    expect(Object.keys(durations)).toEqual([...JOIN_MEASURE_NAMES])
    for (const span of JOIN_MEASURE_NAMES) expect(durations[span]).toBeGreaterThanOrEqual(0)
    expect(join_timing_fight_id()).toBeNull() // a closed trace owns nothing
  })

  test('names the marks the DoD asks for', () => {
    expect([...JOIN_MARK_NAMES]).toEqual(['fight-join:click', 'fight-join:receipt-ready', 'fight-join:seat-visible'])
  })

  test('another fight can neither stage nor close this trace', () => {
    start_join_timing(FIGHT, 'test')
    mark_join_receipt('0xother')
    expect(finish_join_timing('0xother')).toBeNull()
    expect(join_timing_fight_id()).toBe(FIGHT) // still mine, still open
    expect(finish_join_timing(FIGHT)).not.toBeNull()
  })

  test('a create/resume entry (no press behind it) closes nothing', () => {
    cancel_join_timing()
    expect(finish_join_timing(FIGHT)).toBeNull()
    expect(mark_join_receipt(FIGHT)).toBeUndefined()
  })

  test('a refused join leaves no trace armed for the next press to close', () => {
    start_join_timing(FIGHT, 'test')
    cancel_join_timing()
    expect(join_timing_fight_id()).toBeNull()
    expect(finish_join_timing(FIGHT)).toBeNull()
  })
})
