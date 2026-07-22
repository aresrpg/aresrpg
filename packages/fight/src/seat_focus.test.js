// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST for the MULTICHAR seat focus (lane 07-18): the `ctx` input door merges `my_entity_id` but never
// re-resolves `my_key`, so once a seat is stamped at adoption the projection pins it FOREVER — during an owned
// alt's turn the HUD + transaction_character_id keep composing the LEADER's transactions (an on-chain abort =
// burned gas). The ctx door must re-resolve the seat from the adopted view when my_entity_id changes.
import { describe, expect, test } from 'bun:test'

import { create_fight_store } from './store.js'
import { engine_view } from './project.js'
import { transaction_character_id } from './fight_control.js'

const FIGHT = '0xmc'
const OWNER = '0xwallet'
const LEADER = '0xchar_leader'
const ALT = '0xchar_alt'
const T0 = 3_000_000

const participant = (character, cell) => ({
  owner: OWNER,
  addr: OWNER,
  character,
  class: 'senshi',
  team: 0,
  hp: 50,
  max_hp: 50,
  ap: 12,
  mp: 3,
  base_ap: 12,
  base_mp: 3,
  cell,
  ready: true,
  casts_this_turn: 0,
  weapon: null,
})

const fight_object = () => ({
  id: FIGHT,
  status: 1,
  width: 20,
  height: 19,
  participants: [participant(LEADER, 21), participant(ALT, 22)],
  group_template: '0xmob_t',
  group_base_ap: 6,
  group_base_mp: 3,
  mobs: [{ template: '0xmob_t', level: 3, hp: 20, max_hp: 20, cell: 45, ap: 6, mp: 3 }],
  obstacles: [],
  holes: [],
  shape_mask: [],
  start_cells_a: [21, 22],
  start_cells_b: [],
  turn_ptr: 0,
  queue: [],
  turn_deadline_ms: T0 + 30_000,
  placement_deadline_ms: 0,
  world_seed: null,
  spawn_id: null,
  last_action_ms: 0,
})

describe('seat focus — the ctx door re-resolves my_key when my_entity_id switches to another owned seat', () => {
  test('switching ctx.my_entity_id to the alt moves the projection AND the transaction character to its seat', () => {
    const store = create_fight_store()
    store
      .getState()
      .input(
        { type: 'init', fight_id: FIGHT, ctx: { my_entity_id: LEADER, address: OWNER, beat_ctx: { grid_width: 20 } } },
        T0
      )
    store.getState().input({ type: 'snapshot', fight: fight_object(), version: 1 }, T0 + 10)
    expect(store.getState().my_key).toBe('p0') // adoption stamped the leader's seat

    // the HUD focus switch: the acting owned alt becomes my entity through the EXISTING ctx door
    store.getState().input({ type: 'ctx', ctx: { my_entity_id: ALT } }, T0 + 20)

    const state = store.getState()
    expect(state.my_key, 'the ctx switch must re-resolve the seat, not pin the stale one').toBe('p1')
    const view = engine_view(state)
    expect(view.my_entity_id, 'the projection must follow the acting seat').toBe(ALT)
    expect(
      transaction_character_id(view, LEADER),
      'gameplay transactions must now compose for the ALT (a stale seat = a burned-gas abort)'
    ).toBe(ALT)
  })

  test('a ctx merge WITHOUT my_entity_id (mob names etc.) leaves the stamped seat untouched', () => {
    const store = create_fight_store()
    store
      .getState()
      .input(
        { type: 'init', fight_id: FIGHT, ctx: { my_entity_id: ALT, address: OWNER, beat_ctx: { grid_width: 20 } } },
        T0
      )
    store.getState().input({ type: 'snapshot', fight: fight_object(), version: 1 }, T0 + 10)
    expect(store.getState().my_key).toBe('p1')
    store.getState().input({ type: 'ctx', ctx: { mob_names: { '0xmob_t': 'Boar' } } }, T0 + 20)
    expect(store.getState().my_key).toBe('p1')
    expect(engine_view(store.getState()).my_entity_id).toBe(ALT)
  })

  test('a pre-adoption ctx switch keeps my_key null and resolves at the first snapshot', () => {
    const store = create_fight_store()
    store
      .getState()
      .input(
        { type: 'init', fight_id: FIGHT, ctx: { my_entity_id: LEADER, address: OWNER, beat_ctx: { grid_width: 20 } } },
        T0
      )
    store.getState().input({ type: 'ctx', ctx: { my_entity_id: ALT } }, T0 + 5)
    expect(store.getState().my_key).toBe(null) // no view yet — nothing to resolve against
    store.getState().input({ type: 'snapshot', fight: fight_object(), version: 1 }, T0 + 10)
    expect(store.getState().my_key).toBe('p1')
  })

  test('a spectator projects the board without inheriting an owned seat', () => {
    const store = create_fight_store()
    store.getState().input(
      {
        type: 'init',
        fight_id: FIGHT,
        ctx: { spectator: true, my_entity_id: null, address: OWNER, beat_ctx: { grid_width: 20 } },
      },
      T0
    )
    store.getState().input({ type: 'snapshot', fight: fight_object(), version: 1 }, T0 + 10)

    const view = engine_view(store.getState())
    expect(view.spectator).toBe(true)
    expect(view.my_entity_id).toBeNull()
    expect(view.controlled_entity_ids).toEqual([])

    // The global owned-party focus feed remains live while WATCH is mounted. A late focus update must not turn
    // the observer into that owned participant in the raw core (provider/locality read my_key, not the projection).
    store.getState().input({ type: 'ctx', ctx: { my_entity_id: LEADER } }, T0 + 20)
    expect(store.getState()).toMatchObject({
      my_key: null,
      provider: 'idle_wait',
      ctx: { spectator: true, my_entity_id: null, address: null },
    })
    expect(engine_view(store.getState()).my_entity_id).toBeNull()
    const entry_count = Object.keys(store.getState().entries).length
    store.getState().input({ type: 'intent', intent: { kind: 'end_turn' } }, T0 + 30)
    expect(store.getState().refused).toMatchObject({ type: 'intent', reason: 'provider' })
    expect(Object.keys(store.getState().entries)).toHaveLength(entry_count)
  })
})
