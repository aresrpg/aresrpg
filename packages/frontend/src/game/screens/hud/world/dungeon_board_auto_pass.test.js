// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #605 — AUTO-PASS NEVER FIRES ON AN IDLE TURN: with the turn timer visibly present, letting a player turn
// expire did NOTHING — DungeonBoard's auto-commit edge (subscribe_commit_due → auto_submit_ref) special-cased a
// ZERO-draft due commit as a no-op (game_log + clear_picks + return true, NEVER calling flush_commit), even
// though the reducer's OWN commit_due projection fires identically whether or not a draft exists (turn_commit.js's
// auto_commit_decision docblock already says so: "a ZERO-draft turn still fires ... to trigger mob actions"), and
// the manual End-Turn button (on_end_turn) already ships an empty batch unconditionally as a legal on-chain pass.
//
// DungeonBoard.jsx imports the 3D engine (not headless-importable, no jsdom in this repo) — exactly like
// dungeon_board_walk_from.test.js / dungeon_board_cast_presenting_gate.test.js: (A) a REAL @aresrpg/fight store
// proves the CORE arms commit_due on an idle (zero-draft) expired turn, same as a drafted one — the defect was
// never the reducer; (B) a source-contract locks that auto_submit_ref's body has no draft-length gate left to
// skip the flush.

import { describe, expect, test } from 'bun:test'

import { create_fight_store } from '@aresrpg/fight/store'
import * as project from '@aresrpg/fight/project'

const FIGHT = 'fight-605'
const CHAR = 'hero-605'
// Mirrors commit_due_edge.test.js's fixture verbatim (same numbers, same shape) minus its staged intent — the
// ONLY variable under test is draft presence.
const fight_object = {
  id: FIGHT,
  status: 1,
  width: 20,
  height: 19,
  participants: [
    {
      owner: '0xaaa',
      character: CHAR,
      class: 'senshi',
      team: 0,
      ap: 6,
      mp: 3,
      base_ap: 6,
      base_mp: 3,
      hp: 50,
      max_hp: 50,
      cell: 100,
    },
  ],
  mobs: [{ hp: 10, max_hp: 10, cell: 120 }],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_deadline_ms: 100_000,
  last_action_ms: 1_000,
}

const boot_idle = () => {
  const store = create_fight_store()
  store.getState().input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR } })
  store.getState().input({ type: 'snapshot', fight: fight_object, version: 5 }, 1_000)
  return store
}

describe('DungeonBoard auto-commit edge — an idle expired turn is NEVER a no-op (#605)', () => {
  // (A) ROOT FACT, real @aresrpg/fight: commit_due arms identically whether or not a draft is staged — the
  //     reducer never gated the due-commit signal on draft presence; only the JSX submit callback did.
  test('(A) commit_due fires past the deadline with ZERO staged actions, same as with a draft', () => {
    const store = boot_idle()
    expect(project.commit_due(store.getState()), 'not due before the buffer window opens').toBe(false)
    // 99_000 >= turn_deadline_ms(100_000) - COMMIT_BUFFER_MS(5_000) — the SAME buffered instant a drafted turn
    // already auto-commits at (commit_due_edge.test.js pins that leg with a staged move).
    store.getState().input({ type: 'tick' }, 99_000)
    expect(store.getState().staged, 'this IS the idle case — nothing was ever drafted').toEqual([])
    expect(
      project.commit_due(store.getState()),
      'the deadline signal does not care whether a draft exists'
    ).toBe(true)
  })

  // (B) THE FIX, source-contract (red at HEAD): auto_submit_ref's body must carry no draft-length gate — it
  //     flushes the live draft (empty or not) through the SAME door on_end_turn uses, unconditionally.
  test('(B) auto_submit_ref has no zero-draft no-op — it always calls flush_commit', async () => {
    const src = await Bun.file(new URL('./DungeonBoardCommit.jsx', import.meta.url)).text()
    const start = src.indexOf('auto_submit_ref.current = () => {')
    const end = src.indexOf('useEffect(', start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const body = src.slice(start, end)
    // the old defect: a length check + an early return that skipped the commit entirely for an idle turn.
    expect(body).not.toMatch(/draft_actions\.length === 0/)
    expect(body).not.toMatch(/game_log\(/)
    expect(body).not.toMatch(/noop:\s*true/)
    // exactly one return left: the unconditional flush — no branch survives to skip it.
    expect(body.match(/\breturn\b/g)?.length).toBe(1)
    expect(body).toMatch(/return flush_commit\(draft_actions, true\)/)
  })
})
