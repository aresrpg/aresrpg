// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Issue #2000 RED-FIRST — THE STATUS VOCABULARY DROPPED A ROW ONE TURN EARLY.
//
// D42: `remaining_turns` counts the BEARER'S TURNS STILL TO COME, so a counter landing on 0 marks the row's LAST
// COVERED TURN — it is live, it is predicted, it is displayed, and it drops only when the next aging finds it
// already spent (`cast::tick_turn_expiry` → `spell_board::decrement_fighter_statuses`, mirrored by
// `sim/fight_actions.expire_turn_effects` and the fight core's `inputs.age_statuses`).
//
// Both doors of `statuses.js` still read the SUPERSEDED law (`> 0` = alive-after-decrement). `sim_effects_of`
// dropped the row from the prediction sim, so the damage floater priced the UNBUFFED number on the very turn
// the chain resolves the buffed one; `status_row_of` returned null for it, so the simulator's own snapshot —
// which the store treats as authoritative "nobody has one" — DELETED a row the sim still holds.

import { describe, expect, test } from 'bun:test'

import * as SE from '../../sim/src/spell_effect.js'
import { range_bonus_of, sim_effects_of, status_row_of } from '../src/statuses.js'

const last_turn_row = (over = {}) => ({
  kind: SE.K_ALTER_STAT,
  stat: SE.STAT_STRENGTH,
  value: 20,
  element: null,
  chance: 100,
  remaining_turns: 0,
  ...over,
})

describe('#2000 · a row keeps its LAST COVERED TURN through every vocabulary door', () => {
  test('RED: sim_effects_of promotes a 0-counter buff — the prediction prices the turn the chain still resolves under', () => {
    expect(sim_effects_of({ id: 'p0', effects: [last_turn_row()] })).toEqual([
      {
        id: 'strength:0',
        type: 'STAT_BUFF',
        timing: 'TURN_END',
        source_id: 'p0',
        stat: 'strength',
        value: 20,
        turns_remaining: 0,
      },
    ])
  })

  test('RED: the live range fold counts the row on its last covered turn', () => {
    expect(range_bonus_of({ base_range: 6, effects: [last_turn_row({ stat: SE.STAT_RANGE, value: 1 })] })).toBe(7)
  })

  test('RED: status_row_of projects the 0-counter sim effect the snapshot must still state', () => {
    expect(status_row_of({ type: 'STAT_BUFF', stat: 'strength', value: 20, turns_remaining: 0 })).toMatchObject({
      kind: SE.K_ALTER_STAT,
      stat: SE.STAT_STRENGTH,
      value: 20,
      remaining_turns: 0,
    })
  })

  test('and the doors stay inverses on the last covered turn', () => {
    const sim_row = { type: 'STAT_DEBUFF', stat: 'agility', value: 17, turns_remaining: 0 }
    const [round_trip] = sim_effects_of({ id: 'p0', effects: [status_row_of(sim_row)] })

    expect({
      type: round_trip.type,
      stat: round_trip.stat,
      value: round_trip.value,
      turns_remaining: round_trip.turns_remaining,
    }).toEqual(sim_row)
  })

  test('a non-status sim row is still nothing — widening the duration gate did not widen the vocabulary', () => {
    expect(status_row_of({ type: 'DAMAGE', value: 10, turns_remaining: 3 })).toBeNull()
    expect(status_row_of(null)).toBeNull()
  })
})
