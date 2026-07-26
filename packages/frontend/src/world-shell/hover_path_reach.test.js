// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST (#950, the owner-confirmed VISUAL half) — "the painted path crossed cells where the move was
// actually TACKLED short". The hover preview sliced a plain BFS path at the mover's RAW MP, while the green
// wash beside it came from the reducer (`project.move_wash` — the chain's escape contest folded cell-for-cell,
// so a tackled seat's reach is BITTEN back). Two derivations of one fact: the dark path walked straight through
// cells the wash had already refused, and the commit stopped where the wash said, not where the path drew.
//
// Acceptance (the issue's own words): the painted path IS the path the commit folds, every time. These drive
// the REAL core (a seat locked by an adjacent living enemy ⇒ a real tackle) and assert the clip against
// move_wash's own reach.

import { describe, expect, test } from 'bun:test'
import { create_fight_store } from '@aresrpg/fight/store'
import * as project from '@aresrpg/fight/project'
import { bfsPath, encode } from '@aresrpg/fight/los'

import { path_within_reach } from './voxel_fight_folds.js'

const FIGHT_ID = '0xhover-path'
const MY_ADDRESS = '0xowner'
const at = (x, y) => encode(x, y)
/** PINNED, never Date.now(): the escape roll is seeded by (world_seed, spawn_id, turn_deadline_ms, seat), so a
 *  wall-clock deadline makes the contest's outcome — the very thing under test — depend on when the suite runs.
 *  This tuple (seed 1 / spawn 1 / this deadline) is a BITTEN roll: 3 cells still reachable, 45 forfeited. */
const TURN_DEADLINE_MS = 1_700_000_000_000

/** One seat with a mob standing NEXT TO IT: an adjacent living enemy is what locks a tackle contest. */
const decoded_fight = ({ agility = 0, mob_cell = at(3, 5) } = {}) => ({
  id: FIGHT_ID,
  width: 20,
  height: 19,
  status: 1,
  participants: [
    {
      owner: MY_ADDRESS,
      character: 'c1',
      class: 'senshi',
      team: 0,
      hp: 40,
      max_hp: 40,
      ap: 6,
      mp: 5,
      base_ap: 6,
      base_mp: 5,
      cell: at(2, 5),
      ready: true,
      casts_this_turn: 0,
      stats: { agility },
      base_stats: { range: 0 },
    },
  ],
  mobs: [{ template: '0xmob', level: 1, hp: 20, max_hp: 20, cell: mob_cell, ap: 4, mp: 3, alive: true }],
  group_template: '0xgroup',
  group_base_ap: 4,
  group_base_mp: 3,
  obstacles: [],
  holes: [],
  start_cells_a: [at(2, 5)],
  start_cells_b: [mob_cell],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: TURN_DEADLINE_MS,
  placement_deadline_ms: 0,
  world_seed: 1,
  spawn_id: 1,
  anchor_x: 0,
  anchor_z: 0,
  shape_mask: [],
  invisibility_statuses: [],
})

const open_fight = (options) => {
  const store = create_fight_store()
  store.getState().input({
    type: 'init',
    fight_id: FIGHT_ID,
    my_key: null,
    ctx: { address: MY_ADDRESS, roster: [{ id: 'c1', name: 'Kaelen' }], my_entity_id: 'c1', spectator: false },
  })
  store.getState().input({ type: 'snapshot', fight: decoded_fight(options), version: 1 })
  return store
}

describe('#950 — the painted path derives from the reducer’s reachability', () => {
  test('the clip keeps the leading prefix inside the reach and stops at the first refused cell', () => {
    const path = [10, 11, 12, 13]
    expect(path_within_reach(path, new Set([10, 11, 12, 13]))).toEqual(path)
    expect(path_within_reach(path, new Set([10, 11]))).toEqual([10, 11])
    expect(path_within_reach(path, new Set([11, 12, 13]))).toEqual([]) // a refused FIRST step paints nothing
    expect(path_within_reach(path, new Set())).toEqual([])
    expect(path_within_reach([], new Set([10]))).toEqual([])
  })

  test('a TACKLED seat: the painted path stops where the wash stops, not where raw MP would', () => {
    const store = open_fight({ agility: 0 }) // no dodge vs an adjacent locker ⇒ the escape is bitten
    const state = store.getState()
    const wash = project.move_wash(state, {})
    expect(wash.tackled).toBe(true)
    expect(wash.tackle_lost.length).toBeGreaterThan(0) // cells raw MP would reach and the walk will not

    const reach = new Set(wash.reach)
    // hover a cell in the LOST band — exactly the report ("the path crossed cells the move was tackled short of")
    const target = wash.tackle_lost[wash.tackle_lost.length - 1]
    const path = bfsPath(at(2, 5), target, new Set([at(3, 5)]), 20 * 19)
    expect(path.length).toBeGreaterThan(0)

    const painted = path_within_reach(path, reach)
    expect(painted.length).toBeLessThan(path.length) // the flood-fill slice painted the whole thing
    expect(painted.every((cell) => reach.has(cell))).toBe(true)
    expect(painted.some((cell) => wash.tackle_lost.includes(cell))).toBe(false)
  })

  test('an UNTACKLED seat paints its full walk — the clip only ever removes what the fold refuses', () => {
    const store = open_fight({ mob_cell: at(15, 15) }) // no adjacent locker ⇒ no contest
    const wash = project.move_wash(store.getState(), {})
    expect(wash.tackled).toBe(false)
    const reach = new Set(wash.reach)
    const target = at(4, 5) // 2 steps, well inside 5 MP
    const path = bfsPath(at(2, 5), target, new Set(), 20 * 19)
    expect(path_within_reach(path, reach)).toEqual(path)
  })
})
