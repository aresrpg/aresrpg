// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { spell_target_cells, weapon_target_cells } from '../src/effects.ts'
import { KINDS, STATS } from '../src/fighters.ts'

import { create_fixture } from './helpers.ts'

describe('spell target cells', () => {
  test('accepts empty cells inside the visible line-of-sight range', () => {
    const { checkpoint } = create_fixture()
    checkpoint.contract.fighters[0]!.ap = 6n
    const target = checkpoint.contract.fighters[1]!.cell
    const occupied = new Set(checkpoint.contract.fighters.map(({ cell }) => cell))
    const projection = spell_target_cells(checkpoint, 0n, 'slash')
    const empty = projection.range.find((cell) => !occupied.has(cell))

    expect(empty).toBeDefined()
    expect(projection.range).toContain(target)
    expect(projection.targetable).toContain(empty!)
  })

  test('keeps the range visible when no cell is currently castable', () => {
    const { checkpoint } = create_fixture()
    checkpoint.contract.fighters[0]!.ap = 0n
    const projection = spell_target_cells(checkpoint, 0n, 'slash')

    expect(projection.range.length).toBeGreaterThan(0)
    expect(projection.targetable).toEqual([])
  })

  test('keeps cells behind a line-of-sight blocker out of the castable projection', () => {
    const checkpoint = structuredClone(create_fixture().checkpoint)
    checkpoint.contract.closed = checkpoint.contract.closed.map(() => 0n)
    checkpoint.contract.board.obstacles = [102n]
    checkpoint.contract.fighters[0]!.cell = 100n
    checkpoint.contract.fighters[1]!.cell = 105n
    checkpoint.sources.spells.slash.levels[0]!.line_of_sight = true

    const projection = spell_target_cells(checkpoint, 0n, 'slash')

    expect(projection.range).toContain(105n)
    expect(projection.targetable).not.toContain(105n)
  })

  test('an invisible teammate does not block line of sight beyond their cell', () => {
    const checkpoint = structuredClone(create_fixture().checkpoint)
    checkpoint.contract.closed = checkpoint.contract.closed.map(() => 0n)
    checkpoint.contract.board.obstacles = []
    checkpoint.contract.fighters[0]!.cell = 100n
    checkpoint.contract.fighters[0]!.ap = 6n
    checkpoint.contract.fighters[1]!.cell = 102n
    checkpoint.contract.fighters[1]!.team = checkpoint.contract.fighters[0]!.team
    checkpoint.contract.fighters.push({ ...structuredClone(checkpoint.contract.fighters[1]!), team: 1n, cell: 104n })
    checkpoint.sources.spells.slash.levels[0]!.line_of_sight = true
    const visible = spell_target_cells(checkpoint, 0n, 'slash')
    checkpoint.contract.fighters[1]!.effects = [
      { kind: KINDS.invis, element: '', value: 0n, turns_left: 2n, source: 1n, stat: STATS.any },
    ]

    const invisible = spell_target_cells(checkpoint, 0n, 'slash')

    expect(visible.targetable).not.toContain(104n)
    expect(invisible.targetable).toContain(104n)
  })

  test('range theft reduces a modifiable spell below its authored maximum', () => {
    const checkpoint = structuredClone(create_fixture().checkpoint)
    checkpoint.contract.closed = checkpoint.contract.closed.map(() => 0n)
    checkpoint.contract.fighters[0]!.cell = 100n
    checkpoint.contract.fighters[0]!.effects = [
      { kind: KINDS.steal, element: '', value: 1n, turns_left: 2n, source: 1n, stat: STATS.range },
    ]
    checkpoint.sources.spells.slash.levels[0]!.range_max = 3n
    checkpoint.sources.spells.slash.levels[0]!.modifiable_range = true

    const projection = spell_target_cells(checkpoint, 0n, 'slash')

    expect(projection.range).toContain(102n)
    expect(projection.range).not.toContain(103n)
  })

  test('projects the assembled bare-hands strike through the same targeting rules', () => {
    const checkpoint = structuredClone(create_fixture().checkpoint)
    checkpoint.contract.closed = checkpoint.contract.closed.map(() => 0n)
    checkpoint.contract.round = 1n
    checkpoint.contract.queue = [0n, 1n]
    checkpoint.contract.fighters[0]!.cell = 100n
    checkpoint.contract.fighters[0]!.ap = 4n
    checkpoint.contract.fighters[1]!.cell = 101n

    const projection = weapon_target_cells(checkpoint, 0n)

    expect(projection.range).toContain(101n)
    expect(projection.targetable).toContain(101n)
  })
})
