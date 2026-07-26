// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1077 — THE HUD READS THE SEAT'S RANK. Every board surface used to price and range the armed spell off
// `levels[0]`, so a seat that invested a spell to level 6 saw its level-1 numbers: the blue range highlight
// stopped at 1–3 where the chain accepts 1–8, and the wash kept painting on an AP budget that could no longer
// afford the cast (the level-6 cost is higher than the level-1 one it was checking).
//
// The seat's learned levels ride its composed build (`spell_levels`, keyed by the SpellTemplate object id —
// the id a cast actually names on chain). These drive the two pure folds the board paints from, plus the ONE
// door that resolves them, against a synthetic 6-level corpus row seeded through the production loader seam.

import { describe, expect, test, beforeAll } from 'bun:test'

import { set_spell_corpus_for_test } from '../game/data/spell_corpus.js'
import { fight_spell, seat_spell_level, seat_spell_row } from '../game/screens/hud/fight-spells.js'
import { spell_card } from '../game/core/modules/fight.js'

import { seed_range_of, wash_armed_spell } from './voxel_fight_folds.js'

const SPELL_OBJECT_ID = '0xcinder_shaft_template'
const SPELL_KEY = 'cinder_shaft'

// The authored ladder: range and AP cost BOTH climb with the rank, so a level-1 read is distinguishable from a
// level-6 read on each surface independently.
const LADDER = [
  { range_max: 3, ap_cost: 2 },
  { range_max: 4, ap_cost: 2 },
  { range_max: 5, ap_cost: 3 },
  { range_max: 6, ap_cost: 3 },
  { range_max: 7, ap_cost: 4 },
  { range_max: 8, ap_cost: 4 },
]

const CORPUS_ROW = {
  id: 'senshi_cinder_shaft',
  object_id: SPELL_OBJECT_ID,
  name: 'Cinder Shaft',
  classType: 'senshi',
  unlock: 1,
  role: 'damage',
  element: 'fire',
  levels: LADDER.map(({ range_max, ap_cost }, index) => ({
    min_char_level: index + 1,
    ap_cost,
    range_min: 1,
    range_max,
    modifiable_range: false,
    line_of_sight: true,
    line_launch: false,
    free_cell: false,
    casts_per_turn: 255,
    casts_per_target: 255,
    cooldown_turns: 0,
    crit_rate: 0,
    effects: [{ kind: 0, element: 0, value: 10 + index * 4, target_filter: 1, chance: 100 }],
    crit_effects: [],
  })),
}

/** A seat's composed build as the escrow row / fight-view fighter row carries it. */
const seat_at = (level) => ({ spell_levels: level == null ? {} : { [SPELL_OBJECT_ID]: level } })

const SEAT_L6 = seat_at(6)
const SEAT_L1 = seat_at(null) // nothing invested — the free unlock

beforeAll(() => set_spell_corpus_for_test([CORPUS_ROW]))

describe("#1077 — the board paints the seat's spell rank, not level 1", () => {
  test('the level a seat casts at comes off its build, keyed by the SpellTemplate object id', () => {
    const spell = fight_spell(SPELL_KEY)
    expect(spell?.object_id).toBe(SPELL_OBJECT_ID)
    expect(seat_spell_level(SEAT_L6, spell)).toBe(6)
    expect(seat_spell_level(SEAT_L1, spell)).toBe(1) // absent = the free unlock, never a crash
    // a rank past the authored ladder clamps to its last row rather than reading undefined
    expect(seat_spell_level(seat_at(99), spell)).toBe(6)
  })

  test("RED (b): the range highlight derives the seat's level row — 1–8 at rank 6, not 1–3", () => {
    expect(seed_range_of(SPELL_KEY, SEAT_L6)).toEqual([1, LADDER[5].range_max])
    expect(seed_range_of(SPELL_KEY, SEAT_L1)).toEqual([1, LADDER[0].range_max])
  })

  test("RED (c): the AP cost is the level row's cost — the wash clears when rank 6 is unaffordable", () => {
    expect(seat_spell_row(SEAT_L6, fight_spell(SPELL_KEY))?.ap).toBe(LADDER[5].ap_cost)
    // the deck socket prices the SAME row the board gates on — it can never advertise a cost the board refuses
    expect(spell_card(SPELL_KEY, SEAT_L6).cost).toBe(LADDER[5].ap_cost)
    expect(spell_card(SPELL_KEY, SEAT_L6).spell_level).toBe(6)
    expect(spell_card(SPELL_KEY, SEAT_L1).cost).toBe(LADDER[0].ap_cost)
    // 3 AP affords the level-1 cost (2) but NOT the level-6 one (4): the wash must clear, not keep painting.
    expect(wash_armed_spell({ armed_spell_id: SPELL_KEY, active_ap: 3, seat: SEAT_L6 })).toBeNull()
    expect(wash_armed_spell({ armed_spell_id: SPELL_KEY, active_ap: 4, seat: SEAT_L6 })).toBe(SPELL_KEY)
    expect(wash_armed_spell({ armed_spell_id: SPELL_KEY, active_ap: 3, seat: SEAT_L1 })).toBe(SPELL_KEY)
  })
})
