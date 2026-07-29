// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1645 INSTRUMENT TRUTH — "my placement band" has ONE home, and it is resolved through MY OWN SEAT.
//
// The chain declares BOTH placement zones (`placement_cells` keyed by team, #1093) and a seat is not always
// team 0: a PvP/Kolizeum seat sits on team 1. Three readers re-derived this fact independently and one of them
// (the bot seam, `dev_bot_seam.js`) read `placement_cells[0]` unconditionally — so a team-1 seat saw the FOE's
// band, or an EMPTY array whenever team 0 declared none. A driven run cannot tell an empty band apart from an
// unrendered board: the #1645 witnessing rig waits on exactly `placement_cells.length > 0` and calls a no-show
// when it stays empty. An instrument that can report a false no-show cannot adjudicate a real one.

import { describe, expect, test } from 'bun:test'

import { create_fight_store } from '../src/store.js'
import { engine_view_of, my_placement_zone } from '../src/project.js'

const FIGHT = '0xpvp'
const ME = '0xchar_me'
const FOE = '0xchar_foe'
const T0 = 3_000_000

const participant = (owner, character, team, cell) => ({
  owner,
  character,
  class: 'warrior',
  team,
  hp: 50,
  max_hp: 50,
  ap: 12,
  mp: 3,
  base_ap: 12,
  base_mp: 3,
  cell,
  ready: false,
  casts_this_turn: 0,
  weapon: null,
})

/** A PvP-shaped placement fight in which I hold a TEAM-1 seat, so my band is `start_cells_b`. */
const fight_object = () => ({
  id: FIGHT,
  status: 0, // placement — the roster window
  width: 20,
  height: 19,
  participants: [participant('0xfoe', FOE, 0, 21), participant('0xme', ME, 1, 300)],
  group_template: null,
  group_base_ap: 6,
  group_base_mp: 3,
  mobs: [],
  obstacles: [],
  holes: [],
  shape_mask: [],
  start_cells_a: [21, 22], // team 0's band — the foe's
  start_cells_b: [300, 301, 302], // team 1's band — MINE
  turn_ptr: 0,
  queue: [],
  turn_deadline_ms: T0 + 30_000,
  turn_entropy: T0 + 30_000,
  turn_ordinal: 1,
  placement_deadline_ms: T0 + 30_000,
  world_seed: null,
  spawn_id: null,
  last_action_ms: 0,
})

const team_1_seat = () => {
  const store = create_fight_store()
  store
    .getState()
    .input(
      { type: 'init', fight_id: FIGHT, ctx: { my_entity_id: ME, address: '0xme', beat_ctx: { grid_width: 20 } } },
      T0
    )
  store.getState().input({ type: 'snapshot', fight: fight_object(), version: 4 }, T0 + 50)
  return store
}

describe('#1645 — my placement band follows my seat, never team 0', () => {
  test('a team-1 seat resolves team 1’s declared start cells', () => {
    const view = engine_view_of(team_1_seat().getState())
    expect(view).not.toBeNull()
    expect(view.placement).toBe(true)

    expect(my_placement_zone(view)).toEqual([
      { x: 0, y: 15 },
      { x: 1, y: 15 },
      { x: 2, y: 15 },
    ])
  })

  test('the retired `placement_cells[0]` shortcut would have handed that seat the FOE’s band', () => {
    // The exact pre-fix expression, pinned so the defect can never be reintroduced as "equivalent": for this
    // seat it disagrees with the seat-resolved band, which is the whole bug.
    const view = engine_view_of(team_1_seat().getState())

    expect(view.placement_cells[0]).not.toEqual(my_placement_zone(view))
    expect(view.placement_cells[0]).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ])
  })

  test('a seatless view resolves an empty band rather than guessing team 0', () => {
    // An observer/pre-adoption view has no seat to resolve. Returning team 0's band there would paint a
    // stranger's start cells as the viewer's own.
    const seatless = { ...engine_view_of(team_1_seat().getState()), my_entity_id: null }

    expect(my_placement_zone(seatless)).toEqual([])
    expect(my_placement_zone(null)).toEqual([])
  })
})
