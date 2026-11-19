// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { generate_board } from '@aresrpg/fight'
import { expect, test } from 'bun:test'

import {
  fight_board_render,
  fight_placement_overlays,
  scene_fight_view,
} from '../../../src/game/fight/FightViewport.tsx'

test('placement cells are transient overlays rather than static board state', () => {
  const board = fight_board_render(generate_board(1n))
  const overlays = fight_placement_overlays(board, true)

  expect(board.show_start_cells).toBeFalse()
  expect(overlays.map(({ id }) => id)).toEqual(['__fight_start_a', '__fight_start_b'])
  expect(overlays.every(({ blob }) => blob.shape === 'per_cell')).toBeTrue()
  expect(fight_placement_overlays(board, false)).toEqual([])
})

test('ambient presentation appends fighters without claiming presence and removes only its own entities', () => {
  const calls: unknown[] = []
  const scene = {
    show_fight_board: (board: unknown) => calls.push(['board', board]),
    set_entities: () => {
      throw new Error('ambient rendering must not replace world entities')
    },
    set_nearby_entities: (entities: unknown) => calls.push(['nearby', entities]),
  } as unknown as Parameters<typeof scene_fight_view>[0]
  const view = scene_fight_view(scene, true)
  const board = fight_board_render(generate_board(1n))
  view.set_board(board)
  view.set_entities([])
  view.dispose()
  expect(calls).toEqual([
    ['board', { ...board, ambient: true }],
    ['nearby', []],
    ['board', null],
    ['nearby', []],
  ])
})
