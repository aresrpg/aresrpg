// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1743 — ONE HOME FOR "HOW FAR CAN I WALK". The rollback report ("the client lets me path and move while
// tackled, then the receipt disagrees and the whole movement rolls back") is a DUAL-HOME bug: the PAINT
// (project.js move_wash) applies the tackle contest, while DungeonBoard's `reachable` — the CLICK affordance,
// the thing that decides what the player may commit — ran a bare `bfsReachable(anchor, my_mp_eff, blocked)` with
// no tackle at all. So the board offered cells the chain would not take the player to.
//
// With #239's toll landed the chain no longer refuses such a move — it walks the AFFORDABLE PREFIX — so the
// residual defect is a client that predicts a different landing cell than the chain walks. Both halves must
// price the same toll off the SAME contest home (`project.next_move_tackle`), never a second copy of the math.
//
// DungeonBoard.jsx imports the 3D engine (not headless-importable, no jsdom in this repo), so this file follows
// the house pattern of dungeon_board_cast_presenting_gate.test.js: (A) a REAL @aresrpg/fight store proves the
// core facts, (B) a source contract locks that the click affordance reads them.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'bun:test'
import { create_fight_store } from '@aresrpg/fight/store'
import { move_wash, next_move_tackle } from '@aresrpg/fight/project'

const GRID_W = 20
const FIGHT = '0xf1'
const CHAR = '0xc1'
const cell = (x, y) => y * GRID_W + x
const ME_CELL = cell(5, 2)
const ADJ_CELL = cell(6, 2)

// The same geometry + contest the core's own tackle_preview fixture uses: agility 40 vs 40 ⇒ num/den 6/12, and
// world_seed 44 is a seed whose slot-0 roll FAILS — mp 3 − ceil(3·6/12) = 1 MP survives the toll.
const FIGHT_OBJECT = {
  id: FIGHT,
  status: 1,
  width: GRID_W,
  height: 19,
  world_seed: 44,
  spawn_id: 7,
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
      cell: ME_CELL,
      casts_this_turn: 0,
      stats: { agility: 40 },
    },
  ],
  mobs: [
    {
      template: '0xabc',
      hp: 30,
      max_hp: 30,
      cell: ADJ_CELL,
      ap: 4,
      mp: 3,
      level: 1,
      stats: { agility: 40 },
    },
  ],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
  turn_entropy: 90_000,
  turn_ordinal: 1,
}

const boot = () => {
  const store = create_fight_store()
  store.getState().input({ type: 'init', fight_id: FIGHT, ctx: { my_entity_id: CHAR } }, 1000)
  store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1000)
  return store
}

const BOARD_SOURCE = readFileSync(
  fileURLToPath(new URL('../../../../../src/game/screens/hud/world/DungeonBoard.jsx', import.meta.url)),
  'utf8'
)

describe('#1743 — the click affordance and the paint price the same tackle toll', () => {
  test('CORE: the tolled walk budget is a projection, not a UI derivation', () => {
    const state = boot().getState()
    const bite = next_move_tackle(state)
    // The contest home says this move is bitten and names the exact MP the chain will take.
    expect(bite).not.toBeNull()
    expect(bite.mp_lost).toBe(2)
    // …and the paint's green band is exactly the reach of what survives (3 − 2 = 1 MP).
    const wash = move_wash(state, {})
    expect(wash.tackled).toBe(true)
    expect([...wash.reach].sort((a, b) => a - b)).toEqual([cell(5, 1), cell(4, 2), cell(5, 3)])
    // The full raw-MP ring is still described — it is split, never truncated away (#1659).
    expect(wash.tackle_lost.length).toBeGreaterThan(0)
  })

  test('SOURCE: `reachable` budgets the walk with the toll subtracted, off the ONE contest home', () => {
    // The defect this pins: `bfsReachable(draft_caster_cell, my_mp_eff, blocked)` — raw MP, no tackle.
    expect(BOARD_SOURCE).not.toContain('bfsReachable(draft_caster_cell, my_mp_eff, blocked)')
    expect(BOARD_SOURCE).toContain('bfsReachable(draft_caster_cell, tolled_mp, blocked)')
    // …and `tolled_mp` is derived from next_move_tackle, never a re-implementation of the contest.
    expect(BOARD_SOURCE).toContain('const tolled_mp = Math.max(0, my_mp_eff - (move_bite?.mp_lost ?? 0))')
  })

  test('SOURCE: a bitten move WALKS (the toll), it no longer refuses the walk outright', () => {
    // The old NO-WALK LAW staged `landed: !bite` and ran predict_tackle INSTEAD of the walk.
    expect(BOARD_SOURCE).not.toContain('landed: !bite')
    expect(BOARD_SOURCE).not.toContain('else optimistic_walk(cell, plan)')
    expect(BOARD_SOURCE).toContain('if (bite) predict_tackle(bite)')
    expect(BOARD_SOURCE).toContain('optimistic_walk(cell, plan)')
  })
})
