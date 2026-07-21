// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// LANE SIMDRIVE · S2 — the fight BOARD is SIM-DRIVEN through the ONE reducer; a /v1 poll ENTERS the fold normally
// and is DEDUPED when it carries no unseen action (2026-07-16: "the poll just enters the reducers normally
// and is deduped if already played by the sim ... a mob should not rollback after being pushed"). Action identity
// = the Fight object VERSION. A snapshot at a version already folded is dropped; a strictly-newer one folds. These
// drive the fight CORE directly (create_fight_store) and assert through project.board_view — the exact projection
// every board consumer reads. (The inputs-level convergence proof lives in fight/parity.test.js.)

import { describe, test, expect } from 'bun:test'
import { create_fight_store } from '@aresrpg/fight/store'
import * as project from '@aresrpg/fight/project'

const FIGHT_ID = '0xboard-fight'

/** A minimal decoded-Fight-shaped object the core's snapshot door adopts (board_state_from_fight input). */
const decoded_fight = ({ mob_cell, p_cell = 20, status = 1, turn_ptr = 0, deadline = 5000 }) => ({
  id: FIGHT_ID,
  width: 20,
  height: 19,
  status,
  participants: [
    {
      owner: '0xme',
      character: '0xhero',
      class: 'senshi',
      team: 0,
      hp: 40,
      max_hp: 40,
      ap: 6,
      mp: 3,
      base_ap: 6,
      base_mp: 3,
      cell: p_cell,
      ready: true,
      casts_this_turn: 0,
    },
  ],
  mobs: [{ level: 1, hp: 20, max_hp: 20, cell: mob_cell, ap: 4, mp: 3 }],
  group_template: '0xgroup',
  group_base_ap: 4,
  group_base_mp: 3,
  obstacles: [],
  holes: [],
  start_cells_a: [20],
  start_cells_b: [25],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr,
  turn_deadline_ms: deadline,
  placement_deadline_ms: 0,
  world_seed: 1,
  spawn_id: 1,
  anchor_x: 0,
  anchor_z: 0,
  shape_mask: [],
  invisibility_statuses: [],
})

const board = (store) => project.board_view(store.getState())

const opened = () => {
  const store = create_fight_store()
  store.getState().input({ type: 'init', fight_id: FIGHT_ID, my_key: 'p0', ctx: { rooms_total: 1 } })
  return store
}

// M2b · ONE INGRESS (#291): the board advances on CANONICAL events (the accept-machine door), never a re-adopted
// object read. A stale Fight-object re-read is an inert CHECKPOINT, so a pushed mob can never roll back — the
// no-rollback guarantee is now structural, not a version-dedup on the object read.
const push_mob = (store, to_cell, version) =>
  store.getState().input({
    type: 'receipt',
    version,
    receipt: { events: [{ type: '0x0::fight_events::MobMoved', parsedJson: { fight: FIGHT_ID, idx: 0, to_cell } }] },
  })

describe('SIMDRIVE — a pushed mob never rolls back on a stale re-read (checkpoint inertness)', () => {
  test('a stale object re-read is an inert checkpoint; the canonical push keeps the mob cell', () => {
    const store = opened()

    store.getState().input({ type: 'snapshot', fight: decoded_fight({ mob_cell: 100 }), version: 1 }) // bootstrap base
    expect(board(store).mobs[0].cell).toBe(100)

    // the push landed on-chain as a canonical event (the receipt) → the mob folds forward
    push_mob(store, 105, 2)
    expect(board(store).mobs[0].cell).toBe(105)

    // a lagging poll re-delivers the OLD cell as an object read → an inert CHECKPOINT: NO ROLLBACK
    store.getState().input({ type: 'snapshot', fight: decoded_fight({ mob_cell: 100 }), version: 1 })
    expect(board(store).mobs[0].cell).toBe(105)

    // an equal-version object re-read is likewise inert — still no regression
    store.getState().input({ type: 'snapshot', fight: decoded_fight({ mob_cell: 100 }), version: 2 })
    expect(board(store).mobs[0].cell).toBe(105)
  })

  test('the board only advances on canonical events, never a re-adopted object read', () => {
    const store = opened()
    store.getState().input({ type: 'snapshot', fight: decoded_fight({ mob_cell: 100 }), version: 3 })
    expect(board(store).mobs[0].cell).toBe(100)
    push_mob(store, 111, 4)
    expect(board(store).mobs[0].cell).toBe(111)
    expect(board(store).status).toBe(1) // STATUS_ACTIVE — the board is live
  })
})
