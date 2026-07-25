// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Issue #886 RED-FIRST — a fighter nameplate rendered `-32793 Percent Damage · 1 turn` for what is a +25%
// damage buff. `Effect.value` is a u64, so alter_stat (9) / alter_resist (11) mint their SIGNED delta centered
// at 32768; the client was reading the raw wire int. The bias strip belongs at the wire door, once.
//
// CAPTURED WIRE (testnet, `sui client object <id> --json`, 2026-07-26 — real minted MobTemplate spell effects,
// the exact rows a fight's Fight.fx.statuses carries once cast):
//   Razkin           0x4a00a579…be97
//                    kind 9 · stat 8 · value "32793" · flags 0 · turns 2   → authored +25% damage
//   Bonelet          0xb80ade53…d444
//                    kind 9 · stat 3 · value "32751" · flags 8 · turns 2   → authored -17 agility
//   Kraken Leviathan 0x89072bd3…af56
//                    kind 9 · stat 6 · value "32761" · flags 8 · turns 5   → authored -7 range
//   Cauldron Imp     0x8fd65404…5d1d
//                    kind 11 · value "32745" · flags 8 · turns 2           → authored -23 resistance
// The authored magnitudes are the published world_corpus blob's own rows for those mobs (uncentered — only the
// CHAIN mint centers), which is what makes each pair a decode oracle rather than a restatement.

import { describe, expect, test } from 'bun:test'

import { decode_status_value, read_fighter_statuses } from '../src/fight_status_snapshot.js'
import { range_bonus_of, sim_effects_of } from '../src/statuses.js'

const fight_doc = (rows) => ({ fx: { statuses: rows } })

describe('signed chain stat/resist deltas decode at the wire door (#886)', () => {
  test('RED-FIRST: a captured +25% damage buff reads as +25, never the raw 32793', () => {
    const [row] = read_fighter_statuses(
      fight_doc([
        {
          fighter: '0',
          kind: '9',
          remaining_turns: '1',
          effect: { kind: '9', element: '255', value: '32793', stat: '8', chance: '100', flags: '0', turns: '2' },
        },
      ])
    )

    expect(row.value).toBe(25)
    expect(row.stat).toBe(8)
  })

  test('captured NEGATIVE deltas decode to their authored magnitudes with the sign in the value', () => {
    const rows = read_fighter_statuses(
      fight_doc([
        { fighter: '0', kind: '9', remaining_turns: '2', effect: { value: '32751', stat: '3', flags: '8' } },
        { fighter: '0', kind: '9', remaining_turns: '5', effect: { value: '32761', stat: '6', flags: '8' } },
        { fighter: '1001', kind: '11', remaining_turns: '2', effect: { value: '32745', element: '0', flags: '8' } },
      ])
    )

    expect(rows.map((row) => row.value)).toEqual([-17, -7, -23])
  })

  test('non-signed kinds keep their plain magnitude — the decode is per-kind, not per-number', () => {
    const [dot] = read_fighter_statuses(
      fight_doc([{ fighter: '0', kind: '21', remaining_turns: '3', effect: { value: '7', element: '2' } }])
    )

    expect(dot.value).toBe(7)
    expect(decode_status_value(21, 32793)).toBe(32793)
    expect(decode_status_value(9, null)).toBeNull()
  })

  test('the range-bonus prediction folds the decoded sign ONCE — a -7 range debuff never becomes +32761', () => {
    const [debuff] = read_fighter_statuses(
      fight_doc([{ fighter: '0', kind: '9', remaining_turns: '5', effect: { value: '32761', stat: '6', flags: '8' } }])
    )
    const fighter = { id: 'me', base_range: 10, effects: [{ ...debuff, id: 'r0' }] }

    expect(sim_effects_of(fighter)).toEqual([
      {
        id: 'r0',
        type: 'STAT_DEBUFF',
        timing: 'TURN_END',
        source_id: 'me',
        stat: 'range',
        value: 7,
        turns_remaining: 5,
      },
    ])
    expect(range_bonus_of(fighter)).toBe(3)
  })
})
