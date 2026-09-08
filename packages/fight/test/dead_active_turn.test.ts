// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_fight } from '../src/fight.ts'
import { neighbours, mask_get } from '../src/combat_grid.ts'
import { KINDS, STATS } from '../src/fighters.ts'
import type { PlayerFighter } from '../src/types.ts'

import { create_fixture } from './helpers.ts'

for (const cause of ['self_damage', 'reflection', 'trap'] as const) {
  test(`${cause} kills the active player and the same seat can end its turn`, () => {
    const checkpoint = structuredClone(create_fixture().checkpoint)
    const player = checkpoint.contract.fighters[0]!
    const teammate = structuredClone(player) as PlayerFighter
    teammate.kind.character = '0xc2'
    teammate.cell = checkpoint.contract.board.start_cells_a[1]!
    checkpoint.sources.players['0xc2'] = structuredClone(checkpoint.sources.players['0xc1']!)
    checkpoint.contract.fighters.push(teammate)
    const damage_amount = cause === 'self_damage' ? 100n : 1n
    const level = checkpoint.sources.spells.slash!.levels[0]!
    checkpoint.sources.spells.slash!.levels = [
      {
        ...level,
        range_min: 0n,
        effects: [
          {
            ...level.effects[0]!,
            kind: cause === 'self_damage' ? KINDS.caster_damage : KINDS.damage,
            value: damage_amount,
            value_max: damage_amount,
            target_filter: cause === 'self_damage' ? 4n : 0n,
          },
        ],
      },
    ]
    const enemy = checkpoint.contract.fighters[1]!
    if (cause === 'reflection')
      enemy.effects.push({ kind: KINDS.reflect, value: 100n, turns_left: 5n, source: 1n, element: '', stat: STATS.hp })
    const destination = neighbours(player.cell).find(
      (cell) =>
        !mask_get(checkpoint.contract.closed, cell) &&
        !checkpoint.contract.fighters.some((fighter) => fighter.cell === cell)
    )!
    if (cause === 'trap')
      checkpoint.contract.zones = [
        {
          owner_fighter: 1n,
          trap: true,
          shape: 0n,
          size: 0n,
          anchor: destination,
          turns_left: 0n,
          effects: [{ ...level.effects[0]!, kind: KINDS.damage, value: 1000n, value_max: 1000n, target_filter: 0n }],
        },
      ]
    const fight = create_fight({ state: checkpoint, mode: 'local', seed: 91n })
    fight.apply({ type: 'start', observed_ms: 60_000n })
    const result =
      cause === 'trap'
        ? fight.apply({ type: 'move_to', fighter: 0n, path: [destination] })
        : fight.apply({ type: 'cast_spell', fighter: 0n, spell: 'slash', target_cell: enemy.cell })
    expect(result.error).toBeNull()
    expect(result.state.contract.fighters[0]!.dead).toBeTrue()
    expect(result.state.contract.ended).toBeFalse()
    expect(fight.apply({ type: 'cast_spell', fighter: 0n, spell: 'slash', target_cell: enemy.cell }).error?.code).toBe(
      'not_your_fighter'
    )
    const ended = fight.apply({ type: 'end_turn', fighter: 0n, observed_ms: 63_000n })
    expect(ended.error).toBeNull()
    expect(ended.state.contract.queue[Number(ended.state.contract.turn_ptr)]).toBe(2n)
  })
}
