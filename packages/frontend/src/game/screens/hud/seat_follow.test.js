// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST (#948) — with two characters seated, the second one could not be played: the HUD stayed bound to
// the first seat when the second one's turn arrived, so its deck/vitals were unreachable. The live addendum is
// the SAME binding: the expired-turn auto-pass never fired for that seat either (fight/store.js gates the
// auto-commit on `state.active === state.my_key`), so the fight stalled on it.
// These drive the REAL fight core: two seats owned by ONE address (the simulator's shape — every seat shares
// the mock owner — and the production multi-account shape), the SECOND seat's turn active.

import { describe, test, expect } from 'bun:test'
import { create_fight_store } from '@aresrpg/fight/store'
import * as project from '@aresrpg/fight/project'

import { create_seat_follower, focus_seat, next_seat_focus } from './seat_follow.js'

const FIGHT_ID = '0xseat-follow'
const MY_ADDRESS = '0xowner'
const DEADLINE = 5_000

const seat = (character, cell) => ({
  owner: MY_ADDRESS,
  character,
  class: 'senshi',
  team: 0,
  hp: 40,
  max_hp: 40,
  ap: 6,
  mp: 3,
  base_ap: 6,
  base_mp: 3,
  cell,
  ready: true,
  casts_this_turn: 0,
})

/** turn_ptr 1 = the SECOND seat is the active one — the exact state #948 was reported in. */
const decoded_fight = (turn_ptr) => ({
  id: FIGHT_ID,
  width: 20,
  height: 19,
  status: 1,
  participants: [seat('c1', 20), seat('c2', 21)],
  mobs: [{ level: 1, hp: 20, max_hp: 20, cell: 60, ap: 4, mp: 3 }],
  group_template: '0xgroup',
  group_base_ap: 4,
  group_base_mp: 3,
  obstacles: [],
  holes: [],
  start_cells_a: [20, 21],
  start_cells_b: [60],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: false, idx: 1 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr,
  turn_deadline_ms: DEADLINE,
  placement_deadline_ms: 0,
  world_seed: 1,
  spawn_id: 1,
  anchor_x: 0,
  anchor_z: 0,
  shape_mask: [],
  invisibility_statuses: [],
})

/** A live two-seat fight focused on the FIRST seat, with the SECOND seat's turn active. */
const open_fight = (turn_ptr = 1) => {
  const store = create_fight_store()
  store.getState().input({
    type: 'init',
    fight_id: FIGHT_ID,
    my_key: null,
    ctx: {
      address: MY_ADDRESS,
      roster: [
        { id: 'c1', name: 'Kaelen' },
        { id: 'c2', name: 'Mireth' },
      ],
      my_entity_id: 'c1',
      spectator: false,
    },
  })
  store.getState().input({ type: 'snapshot', fight: decoded_fight(turn_ptr), version: 1 })
  return store
}

/** The deadline auto-pass edge: a tick past the fire moment sets the reducer's commit_due level. */
const tick_past_deadline = (store) => {
  store.getState().input({ type: 'tick' }, DEADLINE + 1_000)
  return project.commit_due(store.getState())
}

describe('#948 — the HUD follows every CONTROLLED seat, not just the focused one', () => {
  test('the active seat is controlled but not focused ⇒ the follow re-binds to it', () => {
    const view = project.engine_view_of(open_fight(1).getState())
    expect(view.controlled_entity_ids).toEqual(['c1', 'c2'])
    expect(view.active_controlled_character_id).toBe('c2')
    expect(view.my_entity_id).toBe('c1') // the stuck binding — the whole defect
    expect(next_seat_focus(view)).toBe('c2')
  })

  test('focusing the active seat binds the core to it — the HUD reads that character', () => {
    const store = open_fight(1)
    focus_seat('c2', store)
    const view = project.engine_view_of(store.getState())
    expect(view.my_entity_id).toBe('c2')
    expect(store.getState().my_key).toBe('p1')
    expect(project.is_my_turn(store.getState())).toBe(true)
  })

  test('ADDENDUM — the expired-turn auto-pass only fires for the seat the core is bound to', () => {
    const store = open_fight(1)
    expect(tick_past_deadline(store)).toBe(false) // the stall: seat #2 is overdue and nothing ends its turn
    focus_seat(next_seat_focus(project.engine_view_of(store.getState())), store)
    expect(tick_past_deadline(store)).toBe(true) // scoped to the controlled seat ⇒ the janitor runs
  })

  test('the follower binds ONCE per turn change — a manual pick holds for the rest of that turn', () => {
    const store = open_fight(1)
    const follower = create_seat_follower()
    const view = () => project.engine_view_of(store.getState())

    expect(follower.follow(view())).toBe('c2') // the turn edge: seat #2's turn opened
    focus_seat('c2', store)
    expect(follower.follow(view())).toBe(null) // same turn, already bound
    focus_seat('c1', store) // the player manually inspects seat #1 mid-turn
    expect(follower.follow(view())).toBe(null) // …and the follow does NOT yank it back
  })

  test('a seat already focused, a mob turn and a foreign seat never move the binding', () => {
    expect(next_seat_focus(project.engine_view_of(open_fight(0).getState()))).toBe(null) // seat #1: already focused
    expect(next_seat_focus(project.engine_view_of(open_fight(2).getState()))).toBe(null) // the mob's turn
    expect(next_seat_focus(null)).toBe(null)
    expect(next_seat_focus({ active_controlled_character_id: null, my_entity_id: 'c1' })).toBe(null)
  })
})
