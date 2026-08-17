// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { mask_get } from '../src/combat_grid.ts'
import { base_mp_of, movement_points_of } from '../src/fighters.ts'
import { fight_path_to, reachable_fight_cells } from '../src/movement.ts'
import { create_runtime } from '../src/runtime.ts'

import { create_fixture } from './helpers.ts'

describe('fight movement range', () => {
  test('projects exactly the open, unoccupied cells reachable within the fighter MP budget', () => {
    const { checkpoint } = create_fixture()
    const [fighter] = checkpoint.contract.fighters
    if (!fighter) throw new Error('fixture has no player fighter')
    fighter.mp = 3n
    const occupied = new Set(checkpoint.contract.fighters.filter(({ dead }) => !dead).map(({ cell }) => cell))
    const cells = reachable_fight_cells(checkpoint, 0n)

    expect(cells).not.toContain(fighter.cell)
    expect(cells.every((cell) => !mask_get(checkpoint.contract.closed, cell))).toBeTrue()
    expect(cells.every((cell) => !occupied.has(cell))).toBeTrue()
    expect(cells.length).toBeGreaterThan(0)
  })

  test('dead fighters and fighters without MP expose no movement range', () => {
    const checkpoint = structuredClone(create_fixture().checkpoint)
    checkpoint.contract.fighters[0]!.mp = 0n
    expect(reachable_fight_cells(checkpoint, 0n)).toEqual([])
    checkpoint.contract.fighters[0]!.mp = 3n
    checkpoint.contract.fighters[0]!.dead = true
    expect(reachable_fight_cells(checkpoint, 0n)).toEqual([])
  })

  test('projects an inactive fighter from the points its next turn will refill', () => {
    const { checkpoint } = create_fixture()
    const mob = checkpoint.contract.fighters[1]!
    expect(mob.mp).toBe(0n)
    const allowance = movement_points_of(checkpoint, 1n)
    expect(allowance).toBe(3n)
    expect(reachable_fight_cells(checkpoint, 1n, allowance).length).toBeGreaterThan(0)
  })

  test('steers a deterministic command path through the same reachable field', () => {
    const { checkpoint } = create_fixture()
    const fighter = checkpoint.contract.fighters[0]!
    fighter.mp = 3n
    const target = reachable_fight_cells(checkpoint, 0n).find(
      (cell) => fight_path_to(checkpoint, 0n, cell)?.length === 3
    )
    expect(target).toBeDefined()
    const path = fight_path_to(checkpoint, 0n, target!)
    expect(path).not.toBeNull()
    expect(path?.at(-1)).toBe(target)
    expect(path?.length).toBe(3)
  })

  test('does not steer to occupied or unreachable cells', () => {
    const { checkpoint } = create_fixture()
    checkpoint.contract.fighters[0]!.mp = 3n
    expect(fight_path_to(checkpoint, 0n, checkpoint.contract.fighters[1]!.cell)).toBeNull()
    expect(fight_path_to(checkpoint, 0n, 0xffffn)).toBeNull()
  })

  test('uses the complete folded gear movement bonus for range and pathing', () => {
    const checkpoint = structuredClone(create_fixture().checkpoint)
    const source = checkpoint.sources.players['0xc1']
    if (!source) throw new Error('fixture has no player source')
    source.folded_stats.movement = 32_769n
    const runtime = create_runtime(checkpoint)
    const fighter = runtime.contract.fighters[0]!
    fighter.mp = base_mp_of(runtime, 0n)

    expect(fighter.mp).toBe(4n)
    const target = reachable_fight_cells(runtime, 0n).find((cell) => fight_path_to(runtime, 0n, cell)?.length === 4)
    expect(target).toBeDefined()
    expect(fight_path_to(runtime, 0n, target!)?.length).toBe(4)
  })
})
