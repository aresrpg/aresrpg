// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import boards_source from '../../../../seed/content/fight_boards.json'
import { BoardEditor, fitted_board_cell_size } from '../../src/demo/BoardGallery.tsx'
import {
  board_catalog_errors,
  board_cell_kind,
  board_draft_from,
  board_from_draft,
  create_empty_board,
  paint_board_cell,
  type AuthoredBoard,
} from '../../src/editor/board_editor.ts'

const editor_text = Object.freeze({
  fight_board: 'Fight board',
  board_back: 'All boards',
  board_delete: 'Delete board',
  board_canvas: 'Canvas',
  board_output: 'Final board',
  board_draw_hint: 'Draw',
  board_cell_type: 'Cell type',
  board_cell_void: 'Void',
  board_cell_floor: 'Floor',
  board_cell_obstacle: 'Obstacle',
  board_cell_hole: 'Hole',
  board_cell_start_a: 'Start A',
  board_cell_start_b: 'Start B',
})
const authored_boards = boards_source.boards as readonly AuthoredBoard[]
const board_signature = (board: AuthoredBoard): readonly string[] => {
  const cells = Array.from({ length: board.height * 20 }, (_, cell) => cell).filter(
    (cell) => cell % 20 < board.width && board_cell_kind(board, cell) !== 'void'
  )
  const min_x = Math.min(...cells.map((cell) => cell % 20))
  const min_y = Math.min(...cells.map((cell) => Math.floor(cell / 20)))
  return cells.map((cell) => `${(cell % 20) - min_x}:${Math.floor(cell / 20) - min_y}:${board_cell_kind(board, cell)}`)
}
const complete_board = (width = 12, height = 12): AuthoredBoard => {
  const offset_x = Math.floor((20 - width) / 2)
  const offset_y = Math.floor((19 - height) / 2)
  const cells = Array.from(
    { length: width * height },
    (_, index) => (offset_y + Math.floor(index / width)) * 20 + offset_x + (index % width)
  )
  const floor = cells.reduce(
    (draft, cell) => paint_board_cell(draft, cell, 'floor'),
    board_draft_from(create_empty_board())
  )
  const start_a = Array.from({ length: 6 }, (_, offset) => offset_y * 20 + offset_x + offset).reduce(
    (draft, cell) => paint_board_cell(draft, cell, 'start_a'),
    floor
  )
  const start_b = Array.from(
    { length: 6 },
    (_, offset) => (offset_y + height - 1) * 20 + offset_x + width - 1 - offset
  ).reduce((draft, cell) => paint_board_cell(draft, cell, 'start_b'), start_a)
  return board_from_draft(start_b)
}

describe('fight board editor model', () => {
  test('fits the contract grid once instead of stretching cells per board', () => {
    expect(fitted_board_cell_size(760, 722)).toBe(38)
    expect(fitted_board_cell_size(400, 380)).toBe(20)
    expect(fitted_board_cell_size(200, 190)).toBe(10)
  })

  test('creates a valid connected starter board with six distinct cells per team', () => {
    const board = complete_board()

    expect(board.width).toBe(12)
    expect(board.height).toBe(12)
    expect(board.shape_mask).toHaveLength(6)
    expect(board.start_cells_a).toHaveLength(6)
    expect(board.start_cells_b).toHaveLength(6)
    expect(new Set([...board.start_cells_a, ...board.start_cells_b]).size).toBe(12)
    expect(board_cell_kind(board, 0)).toBe('start_a')
    expect(board_cell_kind(board, 20 * 11 + 11)).toBe('start_b')
    expect(board_catalog_errors([board])).toEqual([])
  })

  test('creates new boards as a void-only 20x19 draft', () => {
    const board = create_empty_board()
    const draft = board_draft_from(board)

    expect(draft.width).toBe(20)
    expect(draft.height).toBe(19)
    expect(
      Array.from({ length: 20 * 19 }, (_, cell) => board_cell_kind(draft, cell)).every((kind) => kind === 'void')
    ).toBeTrue()
    expect(board_catalog_errors([board]).join('\n')).toContain('start_cells_a holds 0 cells')
  })

  test('crops and rebases the fixed draft to inferred final dimensions', () => {
    const draft = board_draft_from(create_empty_board())
    const painted = paint_board_cell(paint_board_cell(draft, 5 * 20 + 7, 'floor'), 6 * 20 + 9, 'obstacle')
    const board = board_from_draft(painted)

    expect(board.width).toBe(3)
    expect(board.height).toBe(2)
    expect(board_cell_kind(board, 0)).toBe('floor')
    expect(board_cell_kind(board, 22)).toBe('obstacle')
  })

  test('the fixed draft preserves every authored layout and emits a valid cropped board', () => {
    authored_boards.forEach((board) => {
      const draft = board_draft_from(board)
      const output = board_from_draft(draft)
      expect(board_signature(draft)).toEqual(board_signature(board))
      expect(board_signature(output)).toEqual(board_signature(board))
      expect(board_catalog_errors([output])).toEqual([])
      expect(output.width).toBeLessThanOrEqual(board.width)
      expect(output.height).toBeLessThanOrEqual(board.height)
    })
  })

  test('centering a rectangular board in the draft round-trips without changing its stored cells', () => {
    const board = complete_board(8, 8)
    expect(board_from_draft(board_draft_from(board))).toEqual(board)
  })

  test('painting keeps one canonical cell type and updates the shape mask', () => {
    const source = complete_board()
    const obstacle = paint_board_cell(source, 0, 'obstacle')
    const voided = paint_board_cell(obstacle, 0, 'void')
    const restored = paint_board_cell(voided, 0, 'floor')

    expect(board_cell_kind(obstacle, 0)).toBe('obstacle')
    expect(obstacle.start_cells_a).not.toContain(0)
    expect(board_cell_kind(voided, 0)).toBe('void')
    expect(voided.obstacles).not.toContain(0)
    expect(board_cell_kind(restored, 0)).toBe('floor')
    expect(source.start_cells_a).toContain(0)
  })

  test('derives enclosed void as a hole and edge-connected void as outside the board', () => {
    const source = complete_board(8, 8)
    const enclosed = paint_board_cell(source, 3 * 20 + 3, 'void')
    const opened = [2, 1, 0].reduce((board, y) => paint_board_cell(board, y * 20 + 3, 'void'), enclosed)

    expect(board_cell_kind(enclosed, 3 * 20 + 3)).toBe('hole')
    expect(board_cell_kind(opened, 3 * 20 + 3)).toBe('void')
    expect(opened.holes).not.toContain(3 * 20 + 3)
  })

  test('keeps incomplete boards local until both teams and connectivity are valid', () => {
    const board = complete_board()
    const missing_starts = { ...board, start_cells_a: [] }
    const split = Array.from({ length: board.height }, (_, y) => y).reduce(
      (candidate, y) => paint_board_cell(candidate, y * 20 + 6, 'obstacle'),
      board
    )

    expect(board_catalog_errors([missing_starts]).join('\n')).toContain('start_cells_a holds 0 cells')
    expect(board_catalog_errors([split]).join('\n')).toContain('splits into islands')
  })

  test('reserves the error slot and locks navigation while validation is red', () => {
    const render = (error: string | null): string =>
      renderToStaticMarkup(
        createElement(BoardEditor, {
          board: complete_board(),
          board_number: 1,
          can_delete: true,
          can_edit: true,
          error,
          save_status: 'Unsaved',
          text: editor_text,
          on_back: () => undefined,
          on_change: () => undefined,
          on_delete: () => undefined,
        })
      )
    const red = render('RED B-STARTS')
    const clean = render(null)
    const buttons = (markup: string): readonly string[] => markup.match(/<button[^>]*>/g) ?? []

    expect(red).toContain('h-[68px]')
    expect(red).toContain('Delete board')
    expect(clean).toContain('h-[68px]')
    expect(buttons(red)[0]).toContain('disabled=""')
    expect(buttons(red)[1]).not.toContain('disabled=""')
    expect(buttons(clean)[0]).not.toContain('disabled=""')
  })
})
