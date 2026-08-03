// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ② SELF-CLICK IS NOT A ROLLBACK (regression: walking, placing a trap, then clicking on yourself rolled the
// action back — canceling and replaying it should not be possible).
// on_cell_click carried a D254 "click the last drafted step to UNDO it" branch (`cell === last_step ⇒
// pop_move_step`). After a walk the PRESENTED (rendered) cell IS that last step, so clicking your own settled body
// popped the draft — a free cancel-and-replay that also ate the turn clock (feeds ③). Rollback of a
// draft is not a user gesture. The rollback branch is gone; a click on your own cell is an inert no-op.
//
// on_cell_click is a closure inside a browser-only component (DungeonBoard.jsx imports the 3D engine → not
// headless-importable; the repo has no jsdom), so — exactly like dungeon_board_walk_from.test.js — (A) a REAL
// @aresrpg/fight fold proves the self-click == last-step IDENTITY the pop exploited, and (B) a source-contract
// locks that on_cell_click no longer maps a click on the last drafted step to pop_move_step (the red at HEAD).
import { describe, expect, test } from 'bun:test'

import { create_fight_store, presented_state } from '@aresrpg/fight/store'
import { local_move_beats } from '@aresrpg/fight/present'

const GRID_W = 20
const FIGHT = '0xf1'
const CHAR = '0xc1'
const cell = (x, y) => y * GRID_W + x
const dec = (c) => ({ x: c % GRID_W, y: Math.floor(c / GRID_W) })
const ORIGIN = cell(5, 5)
const DEST = cell(8, 5)
const FIGHT_OBJECT = {
  id: FIGHT,
  status: 1,
  width: GRID_W,
  height: 19,
  participants: [
    { owner: '0xaaa', character: CHAR, class: 'senshi', team: 0, ap: 6, mp: 3, base_ap: 6, base_mp: 3, hp: 50, max_hp: 50, cell: ORIGIN, stats: { agility: 40 } },
  ],
  mobs: [{ template: '0xabc', hp: 30, max_hp: 30, cell: cell(15, 15), ap: 4, mp: 3, level: 1, stats: { agility: 40 } }],
  queue: [{ is_mob: false, idx: 0 }, { is_mob: true, idx: 0 }],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
}

describe('② self-click never rolls back a drafted walk', () => {
  // (A) ROOT IDENTITY, real @aresrpg/fight: after the walk folds, the PRESENTED (effective) cell — what the board's
  //     `cell === last_step` compared against — IS the last drafted step. So "click on myself" and "click the last
  //     step" are the SAME cell: the pop that the old branch fired on a self-click.
  test('(A) after a walk, the presented cell equals the last drafted step (self-click == last-step click)', () => {
    const store = create_fight_store()
    store.getState().input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: GRID_W } } })
    store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
    const path = [cell(6, 5), cell(7, 5), DEST].map(dec)
    store.getState().input(
      {
        type: 'intent',
        intent: { kind: 'move', character: CHAR, to_cell: DEST, mp_left: 0 },
        beats: local_move_beats({ fight_id: FIGHT, character: CHAR, to_cell: DEST, path }),
      },
      1_100
    )
    // the drafted last step is DEST; the effective/presented cell folds there too — clicking "myself" IS clicking it.
    expect(presented_state(store.getState()).fighters.p0.cell).toBe(DEST)
  })

  // (B) THE FIX, source-contract (red at HEAD): on_cell_click no longer maps a click on the last drafted step to a
  //     pop. The `cell === last_step ⇒ pop_move_step` rollback branch is gone; a self-click falls through to an
  //     inert no-op (reachable excludes the anchor cell), so a drafted action can never be cancelled by self-click.
  test('(B) on_cell_click has no cell===last_step ⇒ pop_move_step rollback branch', async () => {
    const src = await Bun.file(new URL('./DungeonBoardInput.jsx', import.meta.url)).text()
    const start = src.indexOf('const on_cell_click = (cell, cast_only) =>')
    const end = src.indexOf('// Relay: a click / spell-drop on the rich 3D board', start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const body = src.slice(start, end)
    // no click-triggered move rollback: neither the last-step compare nor the pop call survive inside on_cell_click.
    expect(body).not.toMatch(/===\s*last_step/)
    expect(body).not.toMatch(/pop_move_step\s*\(/)
  })
})
