// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { spell_target_cells, weapon_target_cells } from '../src/effects.ts'

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
