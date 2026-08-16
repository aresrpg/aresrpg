// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The setup board owns placement. Side panels never duplicate these verbs.

import type { FightBoard } from '@aresrpg/fight'

import type { SimulatorState } from '../modules/simulator.ts'

export type SimulatorCellIntent =
  | Readonly<{ type: 'pick_character'; cell: bigint }>
  | Readonly<{ type: 'unplace_character'; cell: bigint }>
  | Readonly<{ type: 'edit_mob'; cell: bigint }>
  | null

export const simulator_cell_intent = (
  board: Readonly<FightBoard>,
  state: Readonly<SimulatorState>,
  cell: bigint
): SimulatorCellIntent => {
  if (board.start_cells_b.includes(cell)) return Object.freeze({ type: 'edit_mob', cell })
  if (!board.start_cells_a.includes(cell)) return null
  return state.character_placements[Number(cell)]
    ? Object.freeze({ type: 'unplace_character', cell })
    : Object.freeze({ type: 'pick_character', cell })
}
