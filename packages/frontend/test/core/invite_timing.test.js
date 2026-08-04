// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2159 DoD ① — the invite path's timing marks. Same contract as the join trace: keyed by the flow's identity,
// inert without a live trace, and it closes only on the invite it was opened for.

import { describe, expect, test } from 'bun:test'

import {
  cancel_invite_timing,
  finish_invite_timing,
  invite_timing_character_id,
  mark_invite_executed,
  start_invite_timing,
  INVITE_MARK_NAMES,
  INVITE_MEASURE_NAMES,
} from '../../src/core/invite_timing.js'

const INVITED = '0xinvited'

describe('invite_timing', () => {
  test('closes click → executed → visible for the invite it was opened for', () => {
    start_invite_timing(INVITED, 'test')
    mark_invite_executed(INVITED)
    const durations = finish_invite_timing(INVITED)
    expect(Object.keys(durations)).toEqual([...INVITE_MEASURE_NAMES])
    for (const span of INVITE_MEASURE_NAMES) expect(durations[span]).toBeGreaterThanOrEqual(0)
    expect(invite_timing_character_id()).toBeNull()
  })

  test('names the marks the DoD asks for', () => {
    expect([...INVITE_MARK_NAMES]).toEqual(['party-invite:click', 'party-invite:executed', 'party-invite:visible'])
  })

  test('a second invite in flight cannot close this one', () => {
    start_invite_timing(INVITED, 'test')
    mark_invite_executed('0xother')
    expect(finish_invite_timing('0xother')).toBeNull()
    expect(invite_timing_character_id()).toBe(INVITED)
    expect(finish_invite_timing(INVITED)).not.toBeNull()
  })

  test('a refused invite closes nothing', () => {
    start_invite_timing(INVITED, 'test')
    cancel_invite_timing()
    expect(finish_invite_timing(INVITED)).toBeNull()
  })
})
