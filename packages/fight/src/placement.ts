// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { is_player } from './fighters.ts'
import type { FightContract } from './types.ts'

export type PlacementMove = Readonly<{ fighter: bigint; from: bigint; to: bigint }>
type PlacementRefusal = 'not_placement' | 'not_your_fighter' | 'bad_cell'

/** Mirrors combat::place plus the core wrapper's ownership check for both affected seats. */
export const placement_plan = (
  contract: Readonly<FightContract>,
  fighter: bigint,
  cell: bigint
): readonly PlacementMove[] | PlacementRefusal => {
  if (contract.round !== 0n || contract.ended) return 'not_placement'
  const actor = contract.fighters[Number(fighter)]
  if (!is_player(actor)) return 'not_your_fighter'
  const starts = actor.team === 0n ? contract.board.start_cells_a : contract.board.start_cells_b
  if ([actor.ready, actor.dead, actor.settled, actor.cell === cell, !starts.includes(cell)].some(Boolean))
    return 'bad_cell'
  const move = Object.freeze({ fighter, from: actor.cell, to: cell })
  const target_seat = contract.fighters.findIndex((candidate) => !candidate.dead && candidate.cell === cell)
  if (target_seat < 0) return Object.freeze([move])
  const target = contract.fighters[target_seat]!
  if (!is_player(target) || target.kind.owner !== actor.kind.owner) return 'not_your_fighter'
  if ([target.ready, target.settled, target.team !== actor.team, !starts.includes(actor.cell)].some(Boolean))
    return 'bad_cell'
  return Object.freeze([move, Object.freeze({ fighter: BigInt(target_seat), from: cell, to: actor.cell })])
}
