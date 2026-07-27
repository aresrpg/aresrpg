// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PLACEMENT BANDS (#1093) — the start-cell zones engine_view declares per team. The board paints MY band as
// 'placement' and the opposing one as 'placement_enemy', and placement_click gates the pick on MY band — all
// three read `placement_cells[team]`, so a band the projection never declares is a bare board and a dead click.
// The chain stores BOTH sides (fight.move BoardGeom start_cells_a/start_cells_b) and stamps every participant's
// team (team 1 = the PvP challenger side); the projection must carry both facts, not assume a PvM seat.

import { describe, expect, test } from 'bun:test'

import { create_fight_store } from '../src/store.js'
import { engine_view, placement_click } from '../src/project.js'

const FIGHT = '0xbandfight'
const ALICE = '0xchar_alice' // seat 0 — team A
const BOB = '0xchar_bob' // seat 1 — team B in the PvP fight
const W = 20
const enc = (x, y) => y * W + x
const A_CELLS = [enc(2, 2), enc(3, 2)]
const B_CELLS = [enc(2, 16), enc(3, 16)]

const participant = (owner, character, cell, team = 0) => ({
  owner,
  character,
  class: 'senshi',
  team,
  hp: 50,
  max_hp: 50,
  ap: 6,
  mp: 3,
  base_ap: 6,
  base_mp: 3,
  cell,
  ready: false,
})

const fight_object = (participants) => ({
  id: FIGHT,
  status: 0, // ENGINE_PLACEMENT
  width: W,
  height: 19,
  participants,
  mobs: [],
  group_template: '0xgroup',
  group_base_ap: 6,
  group_base_mp: 3,
  obstacles: [],
  holes: [],
  shape_mask: [],
  start_cells_a: A_CELLS,
  start_cells_b: B_CELLS,
  turn_ptr: 0,
  queue: [],
  turn_deadline_ms: 0,
  turn_entropy: 0,
  turn_ordinal: 1,
  placement_deadline_ms: 90_000,
  world_seed: 1,
  spawn_id: 1,
})

const boot = (participants, { my_entity_id, my_key }) => {
  const store = create_fight_store()
  store.getState().input({ type: 'init', fight_id: FIGHT, my_key, ctx: { my_entity_id, beat_ctx: { grid_width: W } } })
  store.getState().input({ type: 'snapshot', fight: fight_object(participants), version: 5 }, 1_000)
  return store
}

const pvm = () => boot([participant('0xowner_a', ALICE, A_CELLS[0], 0)], { my_entity_id: ALICE, my_key: 'p0' })
const pvp = () =>
  boot([participant('0xowner_a', ALICE, A_CELLS[0], 0), participant('0xowner_b', BOB, B_CELLS[0], 1)], {
    my_entity_id: BOB,
    my_key: 'p1',
  })

describe('placement bands — every declared start-cell zone projects (#1093)', () => {
  test('team 0 band = the chain start_cells_a (the positive control)', () => {
    const view = engine_view(pvm().getState())
    expect(view.placement).toBe(true)
    expect(view.placement_cells[0]).toEqual(A_CELLS.map((c) => ({ x: c % W, y: Math.floor(c / W) })))
  })

  test('team 1 band = the chain start_cells_b — the opposing zone the board paints as placement_enemy', () => {
    const view = engine_view(pvm().getState())
    expect(view.placement_cells[1]).toEqual(B_CELLS.map((c) => ({ x: c % W, y: Math.floor(c / W) })))
  })

  test("a team-1 seat carries its chain team and gets ITS band, so the player's own zone is never bare", () => {
    const view = engine_view(pvp().getState())
    const me = view.fighters.get(view.my_entity_id)
    expect(me.team).toBe(1)
    expect(view.placement_cells[me.team].length).toBeGreaterThan(0)
  })

  test('a team-1 seat clicking a free cell of ITS band picks (it used to be denied off an empty zone)', () => {
    const store = pvp()
    const [, free] = B_CELLS
    expect(placement_click(store.getState(), { x: free % W, y: Math.floor(free / W) })).toBe('pick')
  })

  test('a team-1 seat clicking the OPPOSING band is still denied', () => {
    const store = pvp()
    const [, foe] = A_CELLS
    expect(placement_click(store.getState(), { x: foe % W, y: Math.floor(foe / W) })).toBe('deny')
  })
})
