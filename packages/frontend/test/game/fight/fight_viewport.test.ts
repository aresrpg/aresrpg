// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { generate_board } from '@aresrpg/fight'
import { expect, test } from 'bun:test'

import { fight_board_render, fight_placement_overlays } from '../../../src/game/fight/FightViewport.tsx'

test('placement cells are transient overlays rather than static board state', () => {
  const board = fight_board_render(generate_board(1n))
  const overlays = fight_placement_overlays(board, true)

  expect(board.show_start_cells).toBeFalse()
  expect(overlays.map(({ id }) => id)).toEqual(['__fight_start_a', '__fight_start_b'])
  expect(overlays.every(({ blob }) => blob.shape === 'per_cell')).toBeTrue()
  expect(fight_placement_overlays(board, false)).toEqual([])
})
