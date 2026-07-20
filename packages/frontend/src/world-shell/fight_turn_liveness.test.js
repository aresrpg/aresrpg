// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// LANE SIMDRIVE · S1 — the fight turn is EVENT/SIM-DRIVEN; snapshots only reconcile (lag may
// delay reconciliation, never playability). The PRODQA dead-turn class: after a player ends a turn, the on-chain
// `resolve_from` runs the mob wave INLINE and emits TurnStarted(next player) back in the SAME receipt the client
// signs — that authoritative turn must be LIVE the instant the receipt folds, never deferred to the /v1 poll.
// These drive the fight CORE directly (create_fight_store) and assert the turn through project — the exact gate the
// END-TURN button + input layer read.

import { describe, test, expect } from 'bun:test'
import { create_fight_store } from '@aresrpg/fight/store'
import * as project from '@aresrpg/fight/project'

const FIGHT_ID = '0xturn-fight'
const PKG = '0xengine'
const ev = (name, json) => ({ type: `${PKG}::fight_events::${name}`, parsedJson: { fight: FIGHT_ID, ...json } })

const decoded_fight = ({ deadline = 5000 }) => ({
  id: FIGHT_ID,
  width: 20,
  height: 19,
  status: 1, // ACTIVE
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
      cell: 20,
      ready: true,
      casts_this_turn: 0,
    },
  ],
  mobs: [{ level: 1, hp: 20, max_hp: 20, cell: 100, ap: 4, mp: 3 }],
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
  turn_ptr: 0, // p0's turn
  turn_deadline_ms: deadline,
  placement_deadline_ms: 0,
  world_seed: 1,
  spawn_id: 1,
  anchor_x: 0,
  anchor_z: 0,
  shape_mask: [],
  invisibility_statuses: [],
})

const opened = () => {
  const store = create_fight_store()
  store.getState().input({ type: 'init', fight_id: FIGHT_ID, my_key: 'p0', ctx: { rooms_total: 1 } })
  store.getState().input({ type: 'snapshot', fight: decoded_fight({ deadline: 5000 }), version: 1 })
  return store
}

describe('SIMDRIVE — the end-turn receipt hands the turn back INSTANTLY (no poll)', () => {
  test('a receipt with the inline mob wave + TurnStarted(me) makes it my turn again this tick', () => {
    const store = opened()
    expect(project.is_my_turn(store.getState())).toBe(true) // seeded on my turn

    // I end my turn; the receipt resolves the mob wave INLINE and hands control BACK to me with a FRESH deadline.
    store.getState().input(
      {
        type: 'receipt',
        version: 2,
        receipt: {
          events: [
            ev('TurnEnded', { is_mob: false, idx: 0 }),
            ev('MobMoved', { idx: 0, to_cell: 90 }),
            ev('Hit', { victim_is_mob: false, victim_idx: 0, amount: 5, remaining_hp: 35 }),
            ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: 9000 }),
          ],
        },
      },
      1_000
    )

    // committed truth — LIVE the instant the receipt folds, before any /v1 poll:
    const s = store.getState()
    expect(project.is_my_turn(s)).toBe(true) // it's my turn AGAIN
    expect(project.deadline_ms(s)).toBe(9000) // the chain's fresh turn clock, straight from the receipt
    expect(project.fighter(s, 'p0').hp).toBe(35) // the inline wave folded (I took the mob's hit)
    expect(project.is_over(s)).toBe(false)
  })

  test('a terminal receipt (no TurnStarted) does NOT leave a live turn', () => {
    const store = opened()
    store.getState().input(
      {
        type: 'receipt',
        version: 2,
        receipt: {
          events: [
            ev('TurnEnded', { is_mob: false, idx: 0 }),
            ev('Hit', { victim_is_mob: true, victim_idx: 0, amount: 20, remaining_hp: 0 }),
            ev('Victory', {}),
          ],
        },
      },
      1_000
    )
    const s = store.getState()
    expect(project.is_over(s)).toBe(true)
    expect(project.winner(s)).toBe(0)
    expect(project.is_my_turn(s)).toBe(false)
  })
})
