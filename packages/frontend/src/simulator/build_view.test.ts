// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// build_view.test.ts — the level dropdown's OPTION SET.
//
// The regression this pins: the editor used to offer a free numeric spell-level input, so a player could
// type 6 into a build that could only afford 4 and watch the number silently snap back. The dropdown must
// instead SHOW every reachable level and mark the unaffordable ones disabled, with their cost — and the
// enabled set must be exactly what the reducer's own `spell_level_set` would accept, never a second opinion.

import { describe, test, expect } from 'bun:test'

import { reachable_level, spell_level_options, type GrimoireRow } from './build_view'
import {
  EMPTY_STAT_ALLOC,
  reduce_simulator,
  spell_cost,
  type SimCharacter,
  type SimulatorState,
  INITIAL_SIMULATOR_STATE,
} from './reducer'

/** A six-level spell whose levels unlock at 1/10/20/30/40/50 — the shape a chain SpellTemplate carries. */
const ROW: GrimoireRow = {
  id: '0xspell',
  name: 'Ember Strike',
  name_key: 'ember_strike',
  icon: 'ember_strike',
  color: '#ff4500',
  levels: [1, 10, 20, 30, 40, 50].map((min_char_level) => ({ min_char_level })),
  unlock_tier: 1,
  unlocked: true,
  current_level: 1,
  subline_kind: 'fire',
  subline_descriptor: 'damage',
}

const character = (level: number, spell_levels: Record<string, number> = {}): SimCharacter => ({
  id: 'sim_c1',
  name: 'Probe',
  class_id: 'senshi',
  male: true,
  level,
  stat_alloc: EMPTY_STAT_ALLOC,
  spell_levels,
  loadout: {},
})

describe('reachable_level', () => {
  test('caps at the levels whose own min_char_level the character meets', () => {
    expect(reachable_level(ROW, 1)).toBe(1)
    expect(reachable_level(ROW, 25)).toBe(3)
    expect(reachable_level(ROW, 200)).toBe(6)
  })
})

describe('spell_level_options', () => {
  test('lists every reachable level with its total S8 cost', () => {
    expect(spell_level_options(character(50), ROW).map(({ level, cost }) => [level, cost])).toEqual([
      [1, 0],
      [2, 1],
      [3, 3],
      [4, 6],
      [5, 10],
      [6, 15],
    ])
  })

  test('the character LEVEL gate caps the list before the budget ever does', () => {
    // A level-10 character has 9 spell points but only two of this spell's levels exist for it yet.
    expect(spell_level_options(character(10), ROW).map(({ level }) => level)).toEqual([1, 2])
  })

  test('a budget already sunk into sibling spells disables the top options', () => {
    // 49 points at level 50; three siblings at level 6 hold 45, leaving 4 — level 4 already costs 6.
    const spent = character(50, { sibling_a: 6, sibling_b: 6, sibling_c: 6 })
    expect(
      spell_level_options(spent, ROW)
        .filter(({ affordable }) => affordable)
        .map(({ level }) => level)
    ).toEqual([1, 2, 3])
  })

  test('the ENABLED set is exactly what the reducer accepts — no option lies', () => {
    const base = character(50, { sibling_a: 6, sibling_b: 6, sibling_c: 6 })
    const state: SimulatorState = { ...INITIAL_SIMULATOR_STATE, roster: [base], focus_id: base.id }
    for (const option of spell_level_options(base, ROW)) {
      const next = reduce_simulator(state, {
        type: 'spell_level_set',
        id: base.id,
        spell_id: ROW.name_key,
        level: option.level,
        max_level: 6,
      })
      const landed = next.roster[0].spell_levels[ROW.name_key] ?? 1
      // An offered-and-enabled level must land exactly; a disabled one must NOT (the reducer refits it down).
      expect(landed === option.level).toBe(option.affordable)
    }
  })

  test('raising a spell refunds its own investment first — its options do not shrink as it grows', () => {
    // At level 6 the spell holds 15 of the 49 points a level-50 character has; re-picking 6 must stay legal.
    const invested = character(50, { [ROW.name_key]: 6 })
    expect(spell_level_options(invested, ROW).every(({ affordable }) => affordable)).toBe(true)
  })

  test('the S8 cost table the options quote is the reducer’s own', () => {
    expect([1, 2, 3, 4, 5, 6].map(spell_cost)).toEqual([0, 1, 3, 6, 10, 15])
  })
})
