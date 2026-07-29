// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1645 INSTRUMENT TRUTH — the bot seam's `placement_cells` must be MY band, never team 0's.
//
// The chain declares BOTH placement zones (`placement_cells` keyed by team, #1093) and a seat is not always
// team 0 — a PvP/Kolizeum seat sits on team 1. The seam read `placement_cells[0]` unconditionally, so a team-1
// seat saw an EMPTY array for the whole placement window. A driven run cannot tell that apart from "the board
// never rendered": the witnessing rig for #1645 waits on exactly `placement_cells.length > 0` and reports a
// no-show when it stays empty. An instrument that reports a false no-show cannot adjudicate a real one.

import { expect, test } from 'bun:test'

import { fight_store } from '@aresrpg/fight/store'
import { engine_view_of, my_placement_zone } from '@aresrpg/fight/project'

import { dev_read } from '../../../src/game/dev/dev_bot_seam.js'

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

// A PvP-shaped placement fight: I hold a TEAM-1 seat, so my start band is `start_cells_b`.
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

const seat_a_team_1_placement_fight = () => {
  fight_store.getState().input(
    {
      type: 'init',
      fight_id: FIGHT,
      ctx: { my_entity_id: ME, address: '0xme', beat_ctx: { grid_width: 20 } },
    },
    T0
  )
  fight_store.getState().input({ type: 'snapshot', fight: fight_object(), version: 4 }, T0 + 50)
}

test('#1645 — the bot seam reports MY placement band for a team-1 seat, not team 0’s', () => {
  seat_a_team_1_placement_fight()

  const read = dev_read()

  expect(read.ok).toBe(true)
  expect(read.placement).toBe(true)
  // RED before the fix: the seam read `placement_cells[0]` — team 0's band — so a team-1 seat got the FOE's
  // two cells (and, whenever team 0 declared none, an empty array that reads as an unrendered board).
  expect(read.placement_cells).toEqual([
    { x: 0, y: 15 },
    { x: 1, y: 15 },
    { x: 2, y: 15 },
  ])
})

test('#1645 — one home: the seam agrees with the resolver the placement click gate uses', () => {
  seat_a_team_1_placement_fight()

  const zone = my_placement_zone(engine_view_of(fight_store.getState()))
  expect(zone.length).toBeGreaterThan(0)
  expect(dev_read().placement_cells).toEqual(zone.map((c) => ({ x: c.x, y: c.y })))
})
