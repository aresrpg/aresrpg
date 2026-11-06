// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_character_source, create_fight_state } from '../src/create.ts'
import { create_fight } from '../src/fight.ts'

export const placement_fixture = () =>
  create_fight_state({
    fight_id: 'swap',
    world: 'nauvis',
    board_seed: 17n,
    players: Array.from({ length: 7 }, (_, index) => ({
      character: `player-${index}`,
      owner: index < 6 ? 'owner' : 'enemy',
      team: index < 6 ? 0n : 1n,
      hp: 55n,
      source: create_character_source({ classe: 'senshi', level: 1n }),
    })),
    mobs: [],
  })

test('an owned teammate swaps atomically even when all six start cells are occupied', () => {
  const initial = placement_fixture()
  const from = initial.contract.fighters[0]!.cell
  const to = initial.contract.fighters[1]!.cell
  const result = create_fight({ state: initial }).apply({ type: 'place', fighter: 0n, cell: to })
  expect(result.error).toBeNull()
  expect(result.state.contract.fighters[0]!.cell).toBe(to)
  expect(result.state.contract.fighters[1]!.cell).toBe(from)
  expect(new Set(result.state.contract.fighters.map(({ cell }) => cell)).size).toBe(7)
  expect(result.events.filter(({ type }) => type === 'fighter_placed').map(({ payload }) => payload)).toEqual([
    { fighter: 0n, from, to },
    { fighter: 1n, from: to, to: from },
  ])
  expect(initial.contract.fighters[0]!.cell).toBe(from)
})

for (const refused of [
  'foreign',
  'ready_actor',
  'ready_target',
  'settled_target',
  'enemy',
  'started',
  'self',
] as const) {
  test(`placement swap refuses ${refused} without moving either fighter`, () => {
    const initial = placement_fixture()
    const actor = initial.contract.fighters[0]!
    const target = initial.contract.fighters[1]!
    if (refused === 'foreign' && target.kind.type === 'player') target.kind.owner = 'another-owner'
    if (refused === 'ready_actor') actor.ready = true
    if (refused === 'ready_target') target.ready = true
    if (refused === 'settled_target') target.settled = true
    if (refused === 'started') initial.contract.round = 1n
    const cell =
      refused === 'enemy' ? initial.contract.fighters[6]!.cell : refused === 'self' ? actor.cell : target.cell
    const result = create_fight({ state: initial }).apply({ type: 'place', fighter: 0n, cell })
    expect(result.error).not.toBeNull()
    expect(result.state.contract.fighters).toEqual(initial.contract.fighters)
    expect(result.events).toHaveLength(0)
  })
}
