// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST (#1042, the near-fix regression of #950) — "hovering a cell BEYOND my move range still paints the
// dark-green path, clipped back into range". #950 replaced a raw-MP slice with a CLIP against the reducer's own
// reachability (project.move_wash), which fixed the lying-path half and left the clip painting a TRUNCATED path
// for a hover the walk can never honour: the cursor sits on an unreachable cell and the board still draws a
// route to somewhere else.
//
// THE RULE (one sentence): the dark-green path preview renders ONLY when the hovered cell is itself in the
// reachable set — hovering any other cell paints NO path. So the reach test is a GATE on the destination, not a
// clip on the walk. These drive the REAL core (a seat locked by an adjacent living enemy ⇒ a real tackle) and
// assert the verdict against move_wash's own reach.
//
// The #771 Bun resolver now makes the adapter graph mountable despite its absent engine-local GLB path. This
// focused fold suite still pins the call site by a source-shape assertion: the one line that decides
// gate-vs-clip, while the dedicated adapter suites exercise real mounted behavior.

import { describe, expect, test } from 'bun:test'
import { create_fight_store } from '@aresrpg/fight/store'
import * as project from '@aresrpg/fight/project'
import { bfsPath, encode } from '@aresrpg/fight/los'

import { reachable_hover_path } from './voxel_fight_folds.js'

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

describe('#1042 — the path preview is a REACH VERDICT on the hovered cell, never a clipped walk', () => {
  test('a reachable destination paints the WHOLE walk; an unreachable one paints nothing at all', () => {
    const path = [10, 11, 12, 13]
    expect(reachable_hover_path(path, new Set([10, 11, 12, 13]))).toEqual(path)
    // the #1042 report: the destination is out of reach, so the board paints NO path — never the prefix that
    // fits, which draws a route to a cell the cursor is not on.
    expect(reachable_hover_path(path, new Set([10, 11]))).toEqual([])
    // and never a path THROUGH a refused cell either (a flood-fill reach cannot produce this, so the verdict
    // owes nothing to that invariant)
    expect(reachable_hover_path(path, new Set([11, 12, 13]))).toEqual([])
    expect(reachable_hover_path(path, new Set())).toEqual([])
    expect(reachable_hover_path([], new Set([10]))).toEqual([])
  })

  test('a TACKLED seat: hovering a cell in the tackle-lost band paints ZERO path cells', () => {
    const store = open_fight({ agility: 0 }) // no dodge vs an adjacent locker ⇒ the escape is bitten
    const state = store.getState()
    const wash = project.move_wash(state, {})
    expect(wash.tackled).toBe(true)
    expect(wash.tackle_lost.length).toBeGreaterThan(0) // cells raw MP would reach and the walk will not

    const reach = new Set(wash.reach)
    // hover a cell in the LOST band — the exact report ("beyond my range, and it still draws a path")
    const target = wash.tackle_lost[wash.tackle_lost.length - 1]
    const path = bfsPath(at(2, 5), target, new Set([at(3, 5)]), 20 * 19)
    expect(path.length).toBeGreaterThan(0)
    expect(reach.has(target)).toBe(false) // precondition: the hovered cell is genuinely out of reach

    expect(reachable_hover_path(path, reach)).toEqual([]) // the clip painted its in-range prefix here
  })

  test('a reachable hover inside a TACKLED seat’s bitten reach still paints its full walk', () => {
    const store = open_fight({ agility: 0 })
    const wash = project.move_wash(store.getState(), {})
    const reach = new Set(wash.reach)
    const target = wash.reach[wash.reach.length - 1]
    const path = bfsPath(at(2, 5), target, new Set([at(3, 5)]), 20 * 19)
    expect(path.length).toBeGreaterThan(0)
    expect(reachable_hover_path(path, reach)).toEqual(path)
  })

  test('an UNTACKLED seat paints its full walk — the gate only ever refuses what the fold refuses', () => {
    const store = open_fight({ mob_cell: at(15, 15) }) // no adjacent locker ⇒ no contest
    const wash = project.move_wash(store.getState(), {})
    expect(wash.tackled).toBe(false)
    const reach = new Set(wash.reach)
    const target = at(4, 5) // 2 steps, well inside 5 MP
    const path = bfsPath(at(2, 5), target, new Set(), 20 * 19)
    expect(reachable_hover_path(path, reach)).toEqual(path)
  })

  test('the adapter’s unarmed hover routes through the GATE — no clip survives at the call site', async () => {
    const src = await Bun.file(new URL('./voxel_fight_adapter.js', import.meta.url)).text()
    expect(src).toContain('reachable_hover_path(path, new Set(wash.reach))')
    expect(src).not.toContain('path_within_reach') // the clip is gone, name and all
  })
})
