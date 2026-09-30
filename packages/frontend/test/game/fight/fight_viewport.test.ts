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

test('authored encounter anchors keep local fights on their exact floor, not the simulator origin or canopy', async () => {
  const { grounded_fight_board } = await import('../../../src/game/fight/FightViewport.tsx')
  const { adventure_fight_position, ADVENTURE_ENCOUNTERS } = await import('../../../src/adventure/content.ts')
  const board = generate_board(1n)
  for (let index = 0; index < ADVENTURE_ENCOUNTERS.length; index++) {
    const anchor = adventure_fight_position(`adventure_${index}`)!
    const rendered = grounded_fight_board(board, () => 150, anchor)
    expect(rendered.origin.x + (rendered.width * rendered.cell_size) / 2).toBe(anchor.x)
    expect(rendered.origin.z + (rendered.height * rendered.cell_size) / 2).toBe(anchor.z)
    expect(rendered.origin.y).toBe(anchor.y + 1)
  }
  expect(adventure_fight_position('other-fight')).toBeNull()
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
