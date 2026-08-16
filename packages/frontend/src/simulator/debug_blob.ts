// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { FightBlobShape, FightBlobSpec } from '@aresrpg/engine'
import { project_board_cells, type FightBoard } from '@aresrpg/fight'

export const simulator_debug_blob = (
  board: Readonly<FightBoard>,
  origin_cell: bigint,
  range: number,
  shape: FightBlobShape,
  color: number
): FightBlobSpec | null => {
  const cells = project_board_cells(board)
  const origin = cells.find(({ cell }) => cell === origin_cell)
  if (!origin || origin.kind === 'hole' || origin.kind === 'obstacle') return null
  const radius = Math.min(8, Math.max(1, Math.floor(range)))
  return Object.freeze({
    cells: Object.freeze(
      cells
        .filter(
          (cell) =>
            cell.kind !== 'hole' &&
            cell.kind !== 'obstacle' &&
            Math.abs(cell.x - origin.x) + Math.abs(cell.y - origin.y) <= radius
        )
        .map(({ cell }) => Number(cell))
    ),
    shape,
    color,
    origin_cell: Number(origin.cell),
    reveal_step_ms: 32,
    duration_ms: 5_000,
  })
}
