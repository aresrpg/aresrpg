// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure edits for the authored Move-twin board. The UI draws cell kinds; this module alone
// translates them to the fixed-stride mask and mutually exclusive cell lists.

export const BOARD_GRID_WIDTH = 20
export const BOARD_GRID_HEIGHT = 19
const BOARD_GRID_CELLS = BOARD_GRID_WIDTH * BOARD_GRID_HEIGHT
const MASK_WORDS = 6

export type BoardCellKind = 'void' | 'floor' | 'obstacle' | 'hole' | 'start_a' | 'start_b'
export type AuthoredBoard = Readonly<{
  width: number
  height: number
  shape_mask: readonly string[]
  obstacles: readonly number[]
  holes: readonly number[]
  start_cells_a: readonly number[]
  start_cells_b: readonly number[]
}>

const contains = (rows: readonly number[], cell: number): boolean => rows.includes(cell)
const on_shape = (board: AuthoredBoard, cell: number): boolean =>
  ((BigInt(board.shape_mask[Math.floor(cell / 64)] ?? '0') >> BigInt(cell % 64)) & 1n) === 1n

const mask_from_cells = (cells: readonly number[]): readonly string[] => {
  const words = Array.from({ length: MASK_WORDS }, () => 0n)
  cells.forEach((cell) => {
    // eslint-disable-next-line functional/immutable-data -- local mask construction owns this fresh array and freezes its projection below
    words[Math.floor(cell / 64)] |= 1n << BigInt(cell % 64)
  })
  return Object.freeze(words.map(String))
}

const cell_in_dimensions = (cell: number, width: number, height: number): boolean =>
  Number.isInteger(cell) &&
  cell >= 0 &&
  cell < BOARD_GRID_CELLS &&
  cell % BOARD_GRID_WIDTH < width &&
  Math.floor(cell / BOARD_GRID_WIDTH) < height

const flood_cells = (
  members: ReadonlySet<number>,
  seeds: readonly number[],
  width: number,
  height: number
): ReadonlySet<number> => {
  const seen = new Set(seeds)
  const frontier = [...seeds]
  while (frontier.length > 0) {
    // eslint-disable-next-line functional/immutable-data -- this fresh local array is flood-fill machinery.
    const cell = frontier.pop()
    if (cell === undefined) continue
    const x = cell % BOARD_GRID_WIDTH
    const neighbours = [
      x > 0 ? cell - 1 : -1,
      x + 1 < width ? cell + 1 : -1,
      cell - BOARD_GRID_WIDTH,
      cell + BOARD_GRID_WIDTH,
    ]
    neighbours.forEach((next) => {
      if (!cell_in_dimensions(next, width, height) || !members.has(next) || seen.has(next)) return
      seen.add(next)
      // eslint-disable-next-line functional/immutable-data -- this fresh local array is flood-fill machinery.
      frontier.push(next)
    })
  }
  return seen
}

const derive_void_regions = (board: AuthoredBoard): AuthoredBoard => {
  const cells = Array.from({ length: board.height * BOARD_GRID_WIDTH }, (_, cell) => cell).filter(
    (cell) => cell % BOARD_GRID_WIDTH < board.width
  )
  const blank = new Set(cells.filter((cell) => !on_shape(board, cell) || contains(board.holes, cell)))
  const edge_blank = [...blank].filter((cell) => {
    const x = cell % BOARD_GRID_WIDTH
    const y = Math.floor(cell / BOARD_GRID_WIDTH)
    return x === 0 || x === board.width - 1 || y === 0 || y === board.height - 1
  })
  const exterior = flood_cells(blank, edge_blank, board.width, board.height)
  const enclosed = [...blank].filter((cell) => !exterior.has(cell))
  const enclosed_set = new Set(enclosed)
  const existing_holes = board.holes.filter((cell) => enclosed_set.has(cell))
  const existing_set = new Set(existing_holes)
  const holes = Object.freeze([...existing_holes, ...enclosed.filter((cell) => !existing_set.has(cell))])
  const occupied = (cell: number): boolean => !blank.has(cell)
  return Object.freeze({
    ...board,
    shape_mask: mask_from_cells(cells.filter((cell) => !exterior.has(cell))),
    obstacles: Object.freeze(board.obstacles.filter(occupied)),
    holes,
    start_cells_a: Object.freeze(board.start_cells_a.filter(occupied)),
    start_cells_b: Object.freeze(board.start_cells_b.filter(occupied)),
  })
}

const list_errors = (
  board: AuthoredBoard,
  index: number,
  field: 'obstacles' | 'holes' | 'start_cells_a' | 'start_cells_b'
): readonly string[] => {
  const rows = board[field]
  const where = `fight_boards[${index}].${field}`
  const off_shape = rows.filter(
    (cell) => !cell_in_dimensions(cell, board.width, board.height) || !on_shape(board, cell)
  )
  return Object.freeze([
    ...(off_shape.length > 0 ? [`RED B-CELLS — ${where} contains off-shape cells: ${off_shape.join(', ')}`] : []),
    ...(new Set(rows).size !== rows.length ? [`RED B-CELLS — ${where} contains duplicate cells`] : []),
  ])
}

export const board_catalog_errors = (boards: readonly AuthoredBoard[]): readonly string[] =>
  Object.freeze(
    boards.flatMap((board, index) => {
      const where = `fight_boards[${index}]`
      if (
        !Number.isInteger(board.width) ||
        !Number.isInteger(board.height) ||
        board.width < 1 ||
        board.width > BOARD_GRID_WIDTH ||
        board.height < 1 ||
        board.height > BOARD_GRID_HEIGHT ||
        board.shape_mask.length !== 6 ||
        board.shape_mask.some((word) => !/^\d+$/.test(word) || BigInt(word) >= 1n << 64n)
      )
        return [`RED B-SHAPE — ${where} has invalid dimensions or mask`]
      const blocked = new Set([...board.obstacles, ...board.holes])
      const open = Array.from({ length: board.height * BOARD_GRID_WIDTH }, (_, cell) => cell).filter(
        (cell) => cell % BOARD_GRID_WIDTH < board.width && on_shape(board, cell) && !blocked.has(cell)
      )
      const [first_open] = open
      const connected =
        first_open === undefined ? 0 : flood_cells(new Set(open), [first_open], board.width, board.height).size
      const overlapping_starts = board.start_cells_a.filter((cell) => board.start_cells_b.includes(cell))
      return [
        ...(['obstacles', 'holes', 'start_cells_a', 'start_cells_b'] as const).flatMap((field) =>
          list_errors(board, index, field)
        ),
        ...(board.start_cells_a.length !== 6
          ? [
              `RED B-STARTS — ${where}.start_cells_a holds ${board.start_cells_a.length} cells; every side requires exactly 6`,
            ]
          : []),
        ...(board.start_cells_b.length !== 6
          ? [
              `RED B-STARTS — ${where}.start_cells_b holds ${board.start_cells_b.length} cells; every side requires exactly 6`,
            ]
          : []),
        ...(board.start_cells_a.some((cell) => blocked.has(cell)) ||
        board.start_cells_b.some((cell) => blocked.has(cell))
          ? [`RED B-STARTS — ${where} places a start cell on a blocker`]
          : []),
        ...(overlapping_starts.length > 0
          ? [`RED B-STARTS — ${where} gives both teams the same starts: ${overlapping_starts.join(', ')}`]
          : []),
        ...(open.length === 0
          ? [`RED B-CONNECT — ${where} has no open cell`]
          : connected !== open.length
            ? [`RED B-CONNECT — ${where} splits into islands: ${connected}/${open.length} open cells reachable`]
            : []),
      ]
    })
  )

export const board_cell_kind = (board: AuthoredBoard, cell: number): BoardCellKind => {
  if (!on_shape(board, cell)) return 'void'
  if (contains(board.holes, cell)) return 'hole'
  if (contains(board.obstacles, cell)) return 'obstacle'
  if (contains(board.start_cells_a, cell)) return 'start_a'
  if (contains(board.start_cells_b, cell)) return 'start_b'
  return 'floor'
}

export const paint_board_cell = (board: AuthoredBoard, cell: number, kind: BoardCellKind): AuthoredBoard => {
  if (!cell_in_dimensions(cell, board.width, board.height) || board_cell_kind(board, cell) === kind) return board
  const shaped_cells = Array.from({ length: BOARD_GRID_CELLS }, (_, candidate) => candidate).filter((candidate) =>
    candidate === cell ? kind !== 'void' : on_shape(board, candidate)
  )
  const without_cell = (rows: readonly number[]): readonly number[] => Object.freeze(rows.filter((row) => row !== cell))
  const with_kind = (rows: readonly number[], candidate: BoardCellKind): readonly number[] =>
    Object.freeze(kind === candidate ? [...without_cell(rows), cell] : without_cell(rows))

  return derive_void_regions(
    Object.freeze({
      ...board,
      shape_mask: mask_from_cells(shaped_cells),
      obstacles: with_kind(board.obstacles, 'obstacle'),
      holes: with_kind(board.holes, 'hole'),
      start_cells_a: with_kind(board.start_cells_a, 'start_a'),
      start_cells_b: with_kind(board.start_cells_b, 'start_b'),
    })
  )
}

const shifted_cell = (cell: number, offset_x: number, offset_y: number): number =>
  (Math.floor(cell / BOARD_GRID_WIDTH) + offset_y) * BOARD_GRID_WIDTH + (cell % BOARD_GRID_WIDTH) + offset_x

export const board_draft_from = (board: AuthoredBoard): AuthoredBoard => {
  const offset_x = Math.floor((BOARD_GRID_WIDTH - board.width) / 2)
  const offset_y = Math.floor((BOARD_GRID_HEIGHT - board.height) / 2)
  const shift = (cell: number): number => shifted_cell(cell, offset_x, offset_y)
  const shaped_cells = Array.from({ length: BOARD_GRID_CELLS }, (_, cell) => cell)
    .filter((cell) => cell_in_dimensions(cell, board.width, board.height) && on_shape(board, cell))
    .map(shift)
  return derive_void_regions(
    Object.freeze({
      width: BOARD_GRID_WIDTH,
      height: BOARD_GRID_HEIGHT,
      shape_mask: mask_from_cells(shaped_cells),
      obstacles: Object.freeze(board.obstacles.map(shift)),
      holes: Object.freeze(board.holes.map(shift)),
      start_cells_a: Object.freeze(board.start_cells_a.map(shift)),
      start_cells_b: Object.freeze(board.start_cells_b.map(shift)),
    })
  )
}

export const board_from_draft = (draft: AuthoredBoard): AuthoredBoard => {
  const shaped_cells = Array.from({ length: BOARD_GRID_CELLS }, (_, cell) => cell).filter((cell) =>
    on_shape(draft, cell)
  )
  if (shaped_cells.length === 0) return create_empty_board()
  const xs = shaped_cells.map((cell) => cell % BOARD_GRID_WIDTH)
  const ys = shaped_cells.map((cell) => Math.floor(cell / BOARD_GRID_WIDTH))
  const min_x = Math.min(...xs)
  const max_x = Math.max(...xs)
  const min_y = Math.min(...ys)
  const max_y = Math.max(...ys)
  const rebase = (cell: number): number => shifted_cell(cell, -min_x, -min_y)
  return derive_void_regions(
    Object.freeze({
      width: max_x - min_x + 1,
      height: max_y - min_y + 1,
      shape_mask: mask_from_cells(shaped_cells.map(rebase)),
      obstacles: Object.freeze(draft.obstacles.map(rebase)),
      holes: Object.freeze(draft.holes.map(rebase)),
      start_cells_a: Object.freeze(draft.start_cells_a.map(rebase)),
      start_cells_b: Object.freeze(draft.start_cells_b.map(rebase)),
    })
  )
}

export const create_empty_board = (): AuthoredBoard =>
  Object.freeze({
    width: 1,
    height: 1,
    shape_mask: mask_from_cells([]),
    obstacles: Object.freeze([]),
    holes: Object.freeze([]),
    start_cells_a: Object.freeze([]),
    start_cells_b: Object.freeze([]),
  })
