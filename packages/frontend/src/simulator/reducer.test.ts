// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The simulator page reducer's law: slot-derived ids, the chain's point budgets (5 stat / 1 spell per level
// from 2, S8 escalating spell cost), and a hydration that can never adopt an invalid build.
import { describe, expect, test } from 'bun:test'
import { STATISTICS_PRIMARY } from '@aresrpg/sdk/stats'

import {
  EMPTY_STAT_ALLOC,
  INITIAL_SIMULATOR_STATE,
  MAX_ROSTER,
  reduce_simulator,
  spell_budget,
  spell_cost,
  spells_spent,
  stat_budget,
  stats_spent,
  type SimulatorInput,
  type SimulatorState,
} from './reducer'

const fold = (inputs: SimulatorInput[], from: SimulatorState = INITIAL_SIMULATOR_STATE): SimulatorState =>
  inputs.reduce(reduce_simulator, from)

const add = (name: string, class_id = 'senshi'): SimulatorInput => ({
  type: 'character_added',
  class_id,
  name,
  male: true,
})

const at_level = (level: number, id = 'sim_c1'): SimulatorInput[] => [add('Kaelis'), { type: 'level_set', id, level }]

describe('stat vocabulary', () => {
  test('the allocatable stats ARE the SDK primaries — no local re-listing drifts', () => {
    expect(Object.keys(EMPTY_STAT_ALLOC)).toEqual([...STATISTICS_PRIMARY])
  })
})

describe('roster CRUD', () => {
  test('ids are slot-derived, the roster caps at six, and a freed slot is reused', () => {
    const full = fold(Array.from({ length: MAX_ROSTER + 1 }, (_, index) => add(`C${index}`)))
    expect(full.roster.map(({ id }) => id)).toEqual(['sim_c1', 'sim_c2', 'sim_c3', 'sim_c4', 'sim_c5', 'sim_c6'])

    const reused = fold([{ type: 'character_removed', id: 'sim_c3' }, add('Late')], full)
    expect(reused.roster.map(({ id }) => id)).toContain('sim_c3')
    expect(reused.roster).toHaveLength(MAX_ROSTER)
  })

  test('focus follows the newest character and falls back when the focused one is deleted', () => {
    const two = fold([add('A'), add('B')])
    expect(two.focus_id).toBe('sim_c2')

    const removed = reduce_simulator(two, { type: 'character_removed', id: 'sim_c2' })
    expect(removed.focus_id).toBe('sim_c1')

    const emptied = reduce_simulator(removed, { type: 'character_removed', id: 'sim_c1' })
    expect(emptied.focus_id).toBeNull()
  })

  test('a blank name falls back to the slot id and a long one is cut to 24 chars', () => {
    const state = fold([add('   '), { type: 'character_named', id: 'sim_c1', name: 'x'.repeat(40) }])
    expect(fold([add('   ')]).roster[0].name).toBe('sim_c1')
    expect(state.roster[0].name).toHaveLength(24)
  })
})

describe('stat points — 5 per level from 2 (progression_math.move)', () => {
  test('allocation clamps to the level budget, and the second stat only gets what is left', () => {
    const capped = fold([...at_level(200), { type: 'stat_set', id: 'sim_c1', stat: 'strength', value: 1000 }])
    expect(stat_budget(200)).toBe(995)
    expect(capped.roster[0].stat_alloc.strength).toBe(995)

    const second = reduce_simulator(capped, { type: 'stat_set', id: 'sim_c1', stat: 'vitality', value: 50 })
    expect(second.roster[0].stat_alloc.vitality).toBe(0)
    expect(stats_spent(second.roster[0])).toBe(995)
  })

  test('a level 1 character has zero points and a reset gives them all back', () => {
    const fresh = fold([add('Fresh')])
    const attempt = reduce_simulator(fresh, { type: 'stat_set', id: 'sim_c1', stat: 'agility', value: 5 })
    expect(attempt.roster[0].stat_alloc.agility).toBe(0)

    const spent = fold([...at_level(11), { type: 'stat_set', id: 'sim_c1', stat: 'agility', value: 50 }])
    expect(spent.roster[0].stat_alloc.agility).toBe(50)
    expect(stats_spent(reduce_simulator(spent, { type: 'stats_reset', id: 'sim_c1' }).roster[0])).toBe(0)
  })

  test('a level DROP rescales the allocation proportionally instead of leaving an illegal build', () => {
    const built = fold([
      ...at_level(200),
      { type: 'stat_set', id: 'sim_c1', stat: 'strength', value: 600 },
      { type: 'stat_set', id: 'sim_c1', stat: 'vitality', value: 395 },
      { type: 'level_set', id: 'sim_c1', level: 50 },
    ])
    const [{ stat_alloc }] = built.roster
    expect(stats_spent(built.roster[0])).toBeLessThanOrEqual(stat_budget(50))
    expect(stat_alloc.strength).toBe(Math.floor((600 * 245) / 995))
    expect(stat_alloc.vitality).toBe(Math.floor((395 * 245) / 995))
  })
})

describe('spell points — 1 per level from 2, S8 escalating cost (spell_level.move)', () => {
  test('raising to level t costs t-1, so a spell at level l has cost l(l-1)/2', () => {
    expect([1, 2, 3, 4, 5, 6].map(spell_cost)).toEqual([0, 1, 3, 6, 10, 15])
  })

  test('a raise clamps to what the budget affords and later spells spend the remainder', () => {
    const state = fold([
      ...at_level(10),
      { type: 'spell_level_set', id: 'sim_c1', spell_id: 'a', level: 5, max_level: 6 },
    ])
    expect(spell_budget(10)).toBe(9)
    // level 5 costs 10 > 9 available → the highest affordable level is 4 (cost 6)
    expect(state.roster[0].spell_levels.a).toBe(4)

    const second = reduce_simulator(state, {
      type: 'spell_level_set',
      id: 'sim_c1',
      spell_id: 'b',
      level: 6,
      max_level: 6,
    })
    expect(second.roster[0].spell_levels.b).toBe(3)
    expect(spells_spent(second.roster[0])).toBe(9)
  })

  test('the template cap wins over the budget, and the free baseline is never stored', () => {
    const capped = fold([
      ...at_level(200),
      { type: 'spell_level_set', id: 'sim_c1', spell_id: 'a', level: 9, max_level: 6 },
    ])
    expect(capped.roster[0].spell_levels.a).toBe(6)

    const lowered = reduce_simulator(capped, {
      type: 'spell_level_set',
      id: 'sim_c1',
      spell_id: 'a',
      level: 1,
      max_level: 6,
    })
    expect(lowered.roster[0].spell_levels).toEqual({})
  })

  test('a level drop re-fits invested spells, and a class switch drops them (ENotClassSpell)', () => {
    const invested = fold([
      ...at_level(200),
      { type: 'spell_level_set', id: 'sim_c1', spell_id: 'a', level: 6, max_level: 6 },
    ])
    const dropped = reduce_simulator(invested, { type: 'level_set', id: 'sim_c1', level: 5 })
    expect(spells_spent(dropped.roster[0])).toBeLessThanOrEqual(spell_budget(5))
    expect(dropped.roster[0].spell_levels.a).toBe(3)

    const reclassed = reduce_simulator(invested, { type: 'character_class_set', id: 'sim_c1', class_id: 'iyashi' })
    expect(reclassed.roster[0].spell_levels).toEqual({})
    expect(reclassed.roster[0].class_id).toBe('iyashi')
  })
})

describe('hydration', () => {
  test('a persisted state round-trips through the hydrated input unchanged', () => {
    const built = fold([
      add('Kaelis'),
      { type: 'seed_set', seed: 0xc81f3a92 },
      { type: 'level_set', id: 'sim_c1', level: 60 },
      { type: 'stat_set', id: 'sim_c1', stat: 'vitality', value: 200 },
      { type: 'spell_level_set', id: 'sim_c1', spell_id: 'ember_strike', level: 4, max_level: 6 },
      add('Nyx', 'iyashi'),
      { type: 'focus_set', id: 'sim_c1' },
    ])
    const hydrated = reduce_simulator(INITIAL_SIMULATOR_STATE, { type: 'hydrated', ...built })
    expect(hydrated).toEqual(built)
  })

  test('a tampered row cannot inject an illegal build — levels, budgets and junk keys are re-normalized', () => {
    const hydrated = reduce_simulator(INITIAL_SIMULATOR_STATE, {
      type: 'hydrated',
      seed: 12,
      focus_id: 'sim_c9',
      roster: [
        {
          id: 'sim_c1',
          name: 'Cheater',
          class_id: 'senshi',
          male: true,
          level: 9999,
          stat_alloc: { vitality: 99999, wisdom: 0, strength: 0, intelligence: 0, chance: 0, agility: 0, hp: 5 },
          spell_levels: { a: 6, baseline: 1 },
          loadout: { WEAPON: 'sword', BAD: 7 },
        },
      ] as never,
    })
    const [character] = hydrated.roster
    expect(character.level).toBe(200)
    expect(stats_spent(character)).toBeLessThanOrEqual(stat_budget(200))
    expect(Object.keys(character.stat_alloc)).toEqual([...STATISTICS_PRIMARY])
    expect(character.spell_levels).toEqual({ a: 6 })
    expect(character.loadout).toEqual({ WEAPON: 'sword' })
    // a focus pointing at nobody falls back to the first surviving seat
    expect(hydrated.focus_id).toBe('sim_c1')
  })

  test('hydration caps the roster at six and an empty database leaves the initial state', () => {
    const overflow = reduce_simulator(INITIAL_SIMULATOR_STATE, {
      type: 'hydrated',
      seed: 0,
      focus_id: null,
      roster: Array.from({ length: 9 }, (_, index) => ({
        id: `sim_c${index + 1}`,
        name: `C${index}`,
        class_id: 'senshi',
        male: true,
        level: 1,
        stat_alloc: EMPTY_STAT_ALLOC,
        spell_levels: {},
        loadout: {},
      })),
    })
    expect(overflow.roster).toHaveLength(MAX_ROSTER)

    expect(
      reduce_simulator(INITIAL_SIMULATOR_STATE, { type: 'hydrated', seed: 0, focus_id: null, roster: [] })
    ).toEqual(INITIAL_SIMULATOR_STATE)
  })
})

// The loadout door (the editor's paper doll): a slot holds a template id, `null` CLEARS it. The invariant
// that matters is the SHAPE — a cleared slot is ABSENT, never a null value, because `resolve_loadout` reads
// "the filled slots" as "the keys present".
describe('loadout_set', () => {
  const with_character = () =>
    reduce_simulator(INITIAL_SIMULATOR_STATE, {
      type: 'character_added',
      class_id: 'senshi',
      name: 'Probe',
      male: true,
    })

  test('assigns a slot, replaces it, and CLEARS it by absence', () => {
    const seated = with_character()
    const [{ id }] = seated.roster

    const equipped = reduce_simulator(seated, { type: 'loadout_set', id, slot: 'pet', template_id: 'fuwa' })
    expect(equipped.roster[0].loadout).toEqual({ pet: 'fuwa' })

    const swapped = reduce_simulator(equipped, { type: 'loadout_set', id, slot: 'pet', template_id: 'kaguya' })
    expect(swapped.roster[0].loadout).toEqual({ pet: 'kaguya' })

    const cleared = reduce_simulator(swapped, { type: 'loadout_set', id, slot: 'pet', template_id: null })
    expect(cleared.roster[0].loadout).toEqual({})
    expect('pet' in cleared.roster[0].loadout).toBe(false)
  })

  test('slots are independent — assigning one never disturbs another', () => {
    const seated = with_character()
    const [{ id }] = seated.roster
    const two = [
      { slot: 'weapon', template_id: 'oak_staff' },
      { slot: 'pet', template_id: 'fuwa' },
    ].reduce((state, row) => reduce_simulator(state, { type: 'loadout_set', id, ...row }), seated)
    expect(two.roster[0].loadout).toEqual({ weapon: 'oak_staff', pet: 'fuwa' })

    const cleared = reduce_simulator(two, { type: 'loadout_set', id, slot: 'weapon', template_id: null })
    expect(cleared.roster[0].loadout).toEqual({ pet: 'fuwa' })
  })

  test('an unknown character id is a no-op, not a crash', () => {
    const seated = with_character()
    expect(reduce_simulator(seated, { type: 'loadout_set', id: 'nobody', slot: 'pet', template_id: 'fuwa' })).toEqual(
      seated
    )
  })
})
