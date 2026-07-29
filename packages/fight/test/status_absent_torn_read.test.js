// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1277 — a torn Fight read that drops `status` while KEEPING the board would look provisional forever.
//
// `Fight.status` is a non-optional engine field (fight.move), so a record that carries a board but no status is a
// TORN read, never a legal one. Decoding it as `Number(fight.status ?? 0)` invents ENGINE_PLACEMENT — the roster
// window — and the adoption door treats placement bases as PROVISIONAL (newest placement read wins, joins are
// still legal). So one status-less read lowers a live ACTIVE base back into placement and the adoption window
// never closes: the roster stays re-derivable for the rest of the fight.
//
// The seal is the completeness gate the door already runs for geometry: a record whose board is intact must also
// carry its lifecycle scalar, decoded once at the seam — nothing downstream may default it.
import { describe, expect, test } from 'bun:test'

import { STATUS_ACTIVE, STATUS_PLACEMENT, fight_read_complete } from '../src/board_state.js'
import { create_fight_store } from '../src/store.js'

const FIGHT = '0xt0rn'
const ME = '0xchar_me'
const T0 = 3_000_000

const participant = (character, cell) => ({
  owner: '0xme',
  character,
  class: 'warrior',
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

const fight_object = (status) => {
  const fight = {
    id: FIGHT,
    status,
    width: 20,
    height: 19,
    participants: [participant(ME, 21)],
    group_template: '0xmob_t',
    group_base_ap: 6,
    group_base_mp: 3,
    mobs: [{ template: '0xmob_t', level: 3, hp: 20, max_hp: 20, cell: 45, ap: 6, mp: 3 }],
    obstacles: [],
    holes: [],
    shape_mask: [],
    start_cells_a: [21],
    start_cells_b: [],
    turn_ptr: 0,
    queue: [],
    turn_deadline_ms: T0 + 30_000,
    turn_entropy: T0 + 30_000,
    turn_ordinal: 1,
    placement_deadline_ms: 0,
    world_seed: null,
    spawn_id: null,
    last_action_ms: 0,
  }
  if (status == null) delete fight.status // the TORN shape: board intact, lifecycle scalar gone
  return fight
}

const seated_store = () => {
  const store = create_fight_store()
  store
    .getState()
    .input({ type: 'init', fight_id: FIGHT, ctx: { my_entity_id: ME, address: '0xme', beat_ctx: { grid_width: 20 } } }, T0)
  return store
}

describe('#1277 — a board-intact / status-absent Fight read is TORN, never placement', () => {
  test('the completeness predicate refuses it, and accepts a status-carrying board', () => {
    expect(fight_read_complete(fight_object(1))).toBe(true)
    expect(fight_read_complete(fight_object(0))).toBe(true) // 0 IS a status (placement), not an absence
    expect(fight_read_complete(fight_object(null))).toBe(false)
  })

  test('RED-FIRST: a status-less read never lowers an adopted ACTIVE base back into the roster window', () => {
    const store = seated_store()
    store.getState().input({ type: 'snapshot', fight: fight_object(1), version: 2 }, T0 + 50)
    expect(store.getState().view?.status).toBe(STATUS_ACTIVE)

    // The same fight, one version later, with `status` dropped by a torn read. Defaulted to 0 it decodes as
    // PLACEMENT and the door adopts it as a newer placement base — the adoption window reopens for good.
    store.getState().input({ type: 'snapshot', fight: fight_object(null), version: 3 }, T0 + 900)

    expect(store.getState().view?.status).toBe(STATUS_ACTIVE)
    expect(store.getState().view?.status).not.toBe(STATUS_PLACEMENT)
  })

  test('RED-FIRST: a status-less read never BOOTSTRAPS a base either — a torn read seeds nothing', () => {
    const store = seated_store()
    store.getState().input({ type: 'snapshot', fight: fight_object(null), version: 2 }, T0 + 50)
    expect(store.getState().view).toBeNull()
  })

  test('control — a real placement read still opens the roster window', () => {
    const store = seated_store()
    store.getState().input({ type: 'snapshot', fight: fight_object(0), version: 2 }, T0 + 50)
    expect(store.getState().view?.status).toBe(STATUS_PLACEMENT)
  })
})
