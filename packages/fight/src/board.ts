// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The renderer-neutral projection of the canonical Move-twin board. Every fight surface consumes this;
// no app is allowed to decode masks or invent cell precedence independently.

import { encode_cell, mask_get } from './combat_grid.ts'
import type { FightBoard } from './types.ts'

export type FightBoardCellKind = 'floor' | 'obstacle' | 'hole' | 'start_a' | 'start_b'
export type FightBoardCell = Readonly<{ cell: bigint; x: number; y: number; kind: FightBoardCellKind }>

export const project_board_cells = (board: Readonly<FightBoard>): readonly FightBoardCell[] => {
  const obstacles = new Set(board.obstacles)
  const holes = new Set(board.holes)
  const start_a = new Set(board.start_cells_a)
  const start_b = new Set(board.start_cells_b)
  return Object.freeze(
    Array.from({ length: Number(board.width * board.height) }, (_, index) => {
      const width = Number(board.width)
      const x = index % width
      const y = Math.floor(index / width)
      const cell = encode_cell(BigInt(x), BigInt(y))
      if (!mask_get(board.shape_mask, cell)) return null
      const kind: FightBoardCellKind = holes.has(cell)
        ? 'hole'
        : obstacles.has(cell)
          ? 'obstacle'
          : start_a.has(cell)
            ? 'start_a'
            : start_b.has(cell)
              ? 'start_b'
              : 'floor'
      return Object.freeze({ cell, x, y, kind })
    }).filter((cell): cell is FightBoardCell => cell !== null)
  )
}
