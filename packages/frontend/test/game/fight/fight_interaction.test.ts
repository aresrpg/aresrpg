// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import type { HydratedFightCheckpoint } from '@aresrpg/fight'

import {
  initial_fight_interaction,
  reduce_fight_interaction,
  reviewed_cell,
} from '../../../src/game/fight/fight_interaction.ts'
import { board_pointer_taps, move_board_pointer } from '../../../src/game/fight/board_pointer.ts'

const checkpoint = { contract: { id: 'fight-1' } } as HydratedFightCheckpoint

test('a changed board, locked actions or a cancelled target cannot confirm', () => {
  const selected = reduce_fight_interaction(initial_fight_interaction, { type: 'action', action: { type: 'weapon' } })
  const targeted = reduce_fight_interaction(selected, { type: 'target', checkpoint, cell: 12n })
  expect(reviewed_cell(targeted, { ...checkpoint }, false)).toBeNull()
  expect(reviewed_cell(targeted, checkpoint, true)).toBeNull()
  expect(reviewed_cell(targeted, null, false)).toBeNull()
  expect(reviewed_cell(reduce_fight_interaction(targeted, { type: 'cancel' }), checkpoint, false)).toBeNull()
  expect(reviewed_cell(targeted, checkpoint, false)).toBe(12n)
})

test('changing the selected action invalidates the target; touch inspection survives mouse leave', () => {
  const targeted = reduce_fight_interaction(initial_fight_interaction, { type: 'target', checkpoint, cell: 12n })
  expect(reduce_fight_interaction(targeted, { type: 'hover', hover: null })).toBe(targeted)
  expect(reduce_fight_interaction(targeted, { type: 'action', action: { type: 'weapon' } }).review).toBeNull()
  expect(reduce_fight_interaction(targeted, { type: 'cancel' }).action).toBeNull()
})

test('dragging out and back, cancelling and another finger cannot become a board tap', () => {
  const down = { id: 4, x: 10, y: 20, dragged: false }
  expect(board_pointer_taps(move_board_pointer(down, 4, 30, 20), 4, 10, 20)).toBe(false)
  expect(board_pointer_taps(down, 8, 10, 20)).toBe(false)
  expect(board_pointer_taps(null, 4, 10, 20)).toBe(false)
  expect(board_pointer_taps(down, 4, 12, 20)).toBe(true)
})
