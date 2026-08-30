// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { KINDS, STATS } from '../src/fighters.ts'
import { project_spell_turn, spell_area_cells } from '../src/spell_turn_projection.ts'

import { create_fixture } from './helpers.ts'

describe('next spell turn projection', () => {
  test('draws one stable critical result per spell for the whole turn', () => {
    const checkpoint = structuredClone(create_fixture().checkpoint)
    checkpoint.contract.turn_seed = 5n
    const level = checkpoint.sources.spells.slash!.levels[0]!
    level.crit_1_in = 3n
    level.crit_effects = structuredClone(level.effects)
    checkpoint.sources.spells.stab = structuredClone(checkpoint.sources.spells.slash!)

    expect(project_spell_turn(checkpoint, 0n, 'slash')?.critical).toBeTrue()
    expect(project_spell_turn(checkpoint, 0n, 'stab')?.critical).toBeFalse()

    checkpoint.contract.turn_slot = 9n
    expect(project_spell_turn(checkpoint, 0n, 'slash')?.critical).toBeTrue()
    expect(project_spell_turn(checkpoint, 0n, 'stab')?.critical).toBeFalse()
  })

  test('a successful draw without authored critical rows remains a normal cast', () => {
    const checkpoint = structuredClone(create_fixture().checkpoint)
    const level = checkpoint.sources.spells.slash.levels[0]!
    checkpoint.contract.turn_seed = 5n
    level.crit_1_in = 3n
    level.crit_effects = []

    expect(project_spell_turn(checkpoint, 0n, 'slash')?.critical).toBeFalse()
  })

  test('projects the effective critical denominator after active effects', () => {
    const checkpoint = structuredClone(create_fixture().checkpoint)
    checkpoint.sources.spells.slash!.levels[0]!.crit_1_in = 3n
    checkpoint.contract.fighters[0]!.effects = [
      {
        kind: KINDS.add,
        element: '',
        value: 9n,
        turns_left: 3n,
        source: 0n,
        stat: STATS.critical,
      },
    ]

    expect(project_spell_turn(checkpoint, 0n, 'slash')?.crit_1_in).toBe(2n)
  })

  test('selects only the deterministic critical branch and resolves its authored roll', () => {
    const checkpoint = structuredClone(create_fixture().checkpoint)
    const level = checkpoint.sources.spells.slash.levels[0]!
    level.crit_1_in = 1n
    level.effects[0]!.value = 1n
    level.effects[0]!.value_max = 2n
    level.crit_effects = [
      { ...level.effects[0]!, value: 30n, value_max: 50n },
      { ...level.effects[0]!, value: 7n, value_max: 7n },
    ]

    const first = project_spell_turn(checkpoint, 0n, 'slash')
    const second = project_spell_turn(checkpoint, 0n, 'slash')

    expect(first?.critical).toBeTrue()
    expect(first).toEqual(second)
    expect(first?.effects).toHaveLength(2)
    expect(first?.effects[0]?.value).toBe(first?.effects[0]?.value_max)
    expect(first?.effects[0]?.value).toBeGreaterThanOrEqual(30n)
    expect(first?.effects[0]?.value).toBeLessThanOrEqual(50n)
    expect(first?.effects.map(({ critical_only }) => critical_only)).toEqual([false, true])
  })

  test('projects the resolved branch area around an empty aim cell', () => {
    const checkpoint = structuredClone(create_fixture().checkpoint)
    const level = checkpoint.sources.spells.slash.levels[0]!
    level.effects[0]!.area_shape = 1n
    level.effects[0]!.area_size = 1n

    expect(spell_area_cells(checkpoint, 0n, 'slash', 24n)).toEqual([4n, 23n, 24n, 25n, 44n])
  })

  test('does not invent target-independent rolls after an AP or MP contest', () => {
    const checkpoint = structuredClone(create_fixture().checkpoint)
    const level = checkpoint.sources.spells.slash.levels[0]!
    level.effects = [
      {
        ...level.effects[0]!,
        kind: KINDS.remove,
        element: '',
        value: 2n,
        value_max: 2n,
        turns: 1n,
        stat: STATS.ap,
      },
      { ...level.effects[0]!, value: 10n, value_max: 20n },
    ]

    const projection = project_spell_turn(checkpoint, 0n, 'slash')

    expect(projection?.effects[1]).toMatchObject({ value: 10n, value_max: 20n })
  })
})
