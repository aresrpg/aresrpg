// BOOT22 dead-click regression — the arena projection must carry the TRUE board walkability.
//
// Live capture (fight 0xa2c0…e23ac, localnet 2026-07-17): the chain board is a 15×16 OCTAGON (shape_mask
// carves the corners — row y=0 is floor only at x=5..9). `engine_view().arena` used to mark ONLY
// obstacles∪holes as blocked, so the out-of-shape cell (10,0) read as walkable floor; a consumer aiming
// there clicks a cell the engine board never built, and board_picking correctly nulls the pick (D75:
// void cells are never pickable) — a dead click with no feedback. One home for walkability truth: the
// arena projection must gate on the SAME shape (dims + mask) the board renders.
import { describe, expect, test } from 'bun:test'

import { engine_view } from './project.js'
import { create_fight_store } from './store.js'

const FIGHT = '0xa2c0'
const CHAR = '0xc1'

/** The exact BoardGeom the BOOT22 fight stored on-chain (sui_getObject, fields.board). */
const BOOT22_BOARD = {
  width: 15,
  height: 16,
  shape_mask: [
    '16149903869990667232',
    '18376938211839443967',
    '18442381207409782911',
    '4611127465991995143',
    '17451517141450688',
    '0',
  ],
  holes: [202, 88, 105, 112], // (2,10) (8,4) (5,5) (12,5) — canonical stride-20
  obstacles: [187, 110], // (7,9) (10,5)
  start_cells_a: [5, 6, 7, 8, 9, 23],
  start_cells_b: [309, 308, 307, 306, 305, 291],
}

const fight_object = (board) => ({
  id: FIGHT,
  status: 1,
  ...board,
  participants: [
    {
      owner: '0xaaa',
      character: CHAR,
      class: 'senshi',
      team: 0,
      ap: 12,
      mp: 6,
      base_ap: 12,
      base_mp: 6,
      hp: 300,
      max_hp: 300,
      cell: 9, // (9,0) — the octagon rim seat BOOT22 placed on
    },
  ],
  mobs: [{ template: '0xabc', hp: 112, max_hp: 112, cell: 44, ap: 4, mp: 3, level: 14 }],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
})

const arena_of = (board) => {
  const store = create_fight_store()
  store.getState().input({
    type: 'init',
    fight_id: FIGHT,
    my_key: 'p0',
    ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: 20 } },
  })
  store.getState().input({ type: 'snapshot', fight: fight_object(board), version: 5 }, 1_000)
  return engine_view(store.getState()).arena
}

describe('arena projection — board-shape walkability (BOOT22 dead-click class)', () => {
  test('out-of-shape cells are blocked: the octagon corner (10,0) is NOT walkable floor', () => {
    const arena = arena_of(BOOT22_BOARD)
    // THE BOOT22 CELL: one step right of the (9,0) seat, outside the shape mask — the harness read 0
    // ("walkable"), clicked it three times, and the engine pick correctly returned null every time.
    expect(arena.cells[0 * 20 + 10]).toBe(1)
    // The whole carved rim of row 0: x 0..4 and 10..14 are out-of-shape.
    for (const x of [0, 1, 2, 3, 4, 10, 11, 12, 13, 14]) expect(arena.cells[x]).toBe(1)
  })

  test('out-of-dims cells are blocked: x ≥ width / y ≥ height inside the canonical window', () => {
    const arena = arena_of(BOOT22_BOARD)
    expect(arena.cells[0 * 20 + 15]).toBe(1) // x=15 on a 15-wide board
    expect(arena.cells[16 * 20 + 7]).toBe(1) // y=16 on a 16-tall board
  })

  test('in-shape floor stays walkable; obstacles and holes stay blocked', () => {
    const arena = arena_of(BOOT22_BOARD)
    expect(arena.cells[0 * 20 + 9]).toBe(0) // (9,0) — my seat, rim floor
    expect(arena.cells[0 * 20 + 5]).toBe(0) // (5,0) — start cell
    expect(arena.cells[7 * 20 + 7]).toBe(0) // (7,7) — mid-shape floor
    expect(arena.cells[110]).toBe(1) // (10,5) obstacle
    expect(arena.cells[187]).toBe(1) // (7,9) obstacle
    expect(arena.cells[202]).toBe(1) // (2,10) hole
    expect(arena.cells[88]).toBe(1) // (8,4) hole
  })

  test('mask-less legacy rect: dims still fence the window (the BOOT16 synthetic shape)', () => {
    const arena = arena_of({ width: 10, height: 10, shape_mask: [], holes: [], obstacles: [] })
    expect(arena.cells[0 * 20 + 9]).toBe(0) // in-rect floor
    expect(arena.cells[0 * 20 + 10]).toBe(1) // x=10 off a 10-wide rect
    expect(arena.cells[11 * 20 + 5]).toBe(1) // (5,11) — the BOOT16 aim cell, y ≥ height
  })
})
