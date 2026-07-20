// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RE-WALK REGRESSION (walk-window out-of-fence finding) — DungeonBoard.optimistic_walk must anchor the walk's
// `from_enc` on the DRAFTED path, NOT the display-held fighter cell. Since d4f9e748 ("display_state holds every
// mover's cell until its walk presents") the PRESENTED cell (`fight.fighters.get(me).cell`, = engine_view) lags at
// the pre-move origin until each walk beat acks. A fast multi-step draft dispatches step N+1 BEFORE step N's walk
// presents, so reading that held cell for `from_enc` yielded the ORIGIN → the beat replays from origin (a re-walk).
// The drafted `move_path` is the SYNCHRONOUS truth (append/pop update it this frame), so the previous drafted step
// is where the new segment truly begins.
//
// optimistic_walk is a closure inside a browser-only component (DungeonBoard.jsx imports the 3D engine → not
// headless-importable, and the repo has no jsdom — .test.jsx renders only leaf components via renderToStaticMarkup).
// So, exactly like wash_armed_affordability.test.js pins its un-drivable render binding: (A) a REAL @aresrpg/fight
// fold proves the display-hold divergence that is the re-walk's root (the held cell IS the origin while the draft
// already reads the dest), and (B) a source-contract locks that optimistic_walk anchors on the draft, not the held
// cell — the red at HEAD.

import { describe, expect, test } from 'bun:test'

import { create_fight_store, presented_state } from '@aresrpg/fight/store'
import { engine_view } from '@aresrpg/fight/project'
import { local_move_beats } from '@aresrpg/fight/present'

const GRID_W = 20
const FIGHT = '0xf1'
const CHAR = '0xc1'
const cell = (x, y) => y * GRID_W + x
const dec = (c) => ({ x: c % GRID_W, y: Math.floor(c / GRID_W) })

const ORIGIN = cell(5, 2) // O — step-1's start (the pre-move cell the display holds at)
const STEP1_DEST = cell(8, 2) // A — step-1's destination (the from a fast step-2 must anchor on)

const FIGHT_OBJECT = {
  id: FIGHT,
  status: 1,
  width: GRID_W,
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
      cell: ORIGIN,
      stats: { agility: 40 },
    },
  ],
  mobs: [{ template: '0xabc', hp: 30, max_hp: 30, cell: cell(5, 5), ap: 4, mp: 3, level: 1, stats: { agility: 40 } }],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
}

const boot_with_step1_walk = () => {
  const store = create_fight_store()
  store.getState().input({
    type: 'init',
    fight_id: FIGHT,
    my_key: 'p0',
    ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: GRID_W } },
  })
  store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
  // Step 1: draft a walk O -> A (as optimistic_walk folds it). The walk beat is in flight (NOT presented).
  const path = [cell(6, 2), cell(7, 2), STEP1_DEST].map(dec)
  store.getState().input(
    {
      type: 'intent',
      intent: { kind: 'move', character: CHAR, to_cell: STEP1_DEST, mp_left: 0 },
      beats: local_move_beats({ fight_id: FIGHT, character: CHAR, to_cell: STEP1_DEST, path }),
    },
    1_100
  )
  return store
}

describe('DungeonBoard optimistic_walk — the walk from is the drafted step, never the display-held cell', () => {
  // (A) ROOT CAUSE, real @aresrpg/fight: with step 1's walk still in flight, the PRESENTED fighter cell (what the
  //     buggy `from_enc = encode(me_slice.cell..)` read) is HELD at the origin, while the EFFECTIVE/draft state
  //     already sees the destination. So a fast step 2 anchored on the held cell re-walks from origin; anchored on
  //     the draft it starts at A. This is the exact divergence the fix rides on.
  test('(A) the display holds the fighter cell at the origin while the draft already reads step-1 dest', () => {
    const store = boot_with_step1_walk()
    // PRESENTED (== DungeonBoard's `fight.fighters.get(me).cell`, engine_view): held at the pre-move origin.
    expect(engine_view(store.getState()).fighters.get(CHAR).cell).toEqual(dec(ORIGIN))
    // EFFECTIVE (what the drafted move_path mirrors): already at step-1's destination A.
    expect(presented_state(store.getState()).fighters.p0.cell).toBe(STEP1_DEST)
    // The bug in one line: held origin !== drafted dest, so anchoring `from_enc` on the held cell re-walks.
    expect(engine_view(store.getState()).fighters.get(CHAR).cell).not.toEqual(dec(STEP1_DEST))
  })

  // (B) THE FIX, source-contract (red at HEAD): optimistic_walk's `from_enc` anchors on the drafted `move_path`
  //     (previous step) with the committed `chain_cell` fallback, and NEVER on the held `me_slice.cell`.
  test('(B) optimistic_walk anchors from_enc on the drafted move_path, not the held me_slice.cell', async () => {
    const src = await Bun.file(new URL('./DungeonBoard.jsx', import.meta.url)).text()
    const start = src.indexOf('const optimistic_walk = (draft) =>')
    const end = src.indexOf('const optimistic_cast =', start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const body = src.slice(start, end)
    const from_line = body.split('\n').find((l) => l.includes('from_enc ='))
    expect(from_line).toBeTruthy()
    // the from is the drafted path (previous step), NOT the display-held fighter cell.
    expect(from_line).toMatch(/move_path/)
    expect(from_line).toMatch(/chain_cell/)
    expect(from_line).not.toMatch(/me_slice/)
  })
})
