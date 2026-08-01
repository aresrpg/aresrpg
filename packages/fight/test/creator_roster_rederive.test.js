// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// THE COOP CENTERPIECE (#1274, the mechanism under the #1146 family). Machine-proven by the coop drive (PR #1261's
// verdict block, two confirming runs): after bob joins alice's fight, ALICE's board reports 3 fighters on a
// 4-fighter fight for the whole fight — her turn_order reads [mob-0, alice, mob-1] every round while bob's reads
// all four, she places seeing every start cell free, and his events never fold onto a seat she has.
//
// ONE MECHANISM: the creator adopts her base at CREATION and the snapshot door never re-adopts, so her roster is
// frozen a version BEFORE the join landed. The joiner boots AFTER the join, so his base is complete — he is the
// reference implementation, and the fix is the creator consuming the SAME derivation (`board_state_from_fight`
// through the SAME `snapshot` door, fed by the 4s object poll that already runs) rather than a second path that
// pokes the missing fighter in.
//
// THE LAW under test: the base is PROVISIONAL exactly while the chain can still grow the roster — `join` is legal
// only during PLACEMENT (engine fight.move `join`, `ENotPlacement`) — and FINAL once the fight is ACTIVE, where
// #701's checkpoint law is untouched (a later object read is stale/torn and never re-adopts).
//
// Two clients, one chain: both stores are fed the SAME decoded object reads, differing only in WHEN they booted.

import { describe, expect, test } from 'bun:test'

import { create_fight_store } from '../src/store.js'
import { project_board } from '../src/core.js'
import * as project from '../src/project.js'

const FIGHT = '0xf1274'
const ALICE = '0xa11ce'
const ALICE_ADDR = '0xA'
const BOB = '0xb0b'
const BOB_ADDR = '0xB'

const participant = ({ character, owner, cell }) => ({
  owner,
  character,
  class: 'senshi',
  team: 0,
  hp: 50,
  max_hp: 50,
  ap: 6,
  mp: 3,
  base_ap: 6,
  base_mp: 3,
  cell,
  ready: false,
  casts_this_turn: 0,
  weapon: null,
})

const mob = (cell) => ({ template: '0xmob', hp: 40, max_hp: 40, cell, ap: 4, mp: 3, level: 3 })

/** The chain record, parameterised by its roster and lifecycle scalar. status 0 = engine PLACEMENT, 1 = ACTIVE. */
const fight_record = ({ participants, status = 0 }) => ({
  id: FIGHT,
  status,
  width: 13,
  height: 12,
  participants,
  mobs: [mob(200), mob(201)],
  queue: [],
  turn_ptr: 0,
  turn_deadline_ms: 0,
  turn_entropy: 0,
  turn_ordinal: 1,
  placement_deadline_ms: 90_000,
  last_action_ms: 0,
  obstacles: [],
  holes: [],
  start_cells_a: [5, 6, 7],
  start_cells_b: [200, 201],
  shape_mask: [],
})

const ALONE = [participant({ character: ALICE, owner: ALICE_ADDR, cell: 5 })]
const BOTH = [
  participant({ character: ALICE, owner: ALICE_ADDR, cell: 5 }),
  participant({ character: BOB, owner: BOB_ADDR, cell: 6 }),
]

/** A client of this fight, seated as `me`. The boot is the production one (`init` → the ONE session door). */
const client = (me, address) => {
  const store = create_fight_store()
  store.getState().input({
    type: 'init',
    fight_id: FIGHT,
    ctx: { my_entity_id: me, address, creator: ALICE_ADDR, beat_ctx: { grid_width: 20 } },
  })
  return store
}

/** The 4s object poll — the signal the creator's client ALREADY receives (dungeon_run_store's live poll → the
 *  core's ONE snapshot door). No new plumbing exists in this test because none exists in the fix. */
const poll = (store, record, version) => store.getState().input({ type: 'snapshot', fight: record, version })

describe('#1274 — the creator re-derives her roster when a join lands', () => {
  test('the creator adopts pre-join, then the SAME read the joiner sees completes her board', () => {
    const alice = client(ALICE, ALICE_ADDR)
    const bob = client(BOB, BOB_ADDR)

    // ① alice creates: her first read is the fight with only her in it (the chain record before bob's join tx).
    poll(alice, fight_record({ participants: ALONE }), 10)
    const before = project.engine_view(alice.getState())
    expect(before.turn_order).toEqual(['mob-0', ALICE, 'mob-1']) // the drive's exact stale row, 3 seats

    // ② bob joins and boots — his first read is post-join, so his base is complete (row ⑥ PASS, run D).
    poll(bob, fight_record({ participants: BOTH }), 11)
    const bob_view = project.engine_view(bob.getState())
    expect(bob_view.turn_order).toEqual([ALICE, 'mob-0', BOB, 'mob-1'])

    // ③ alice's next 4s poll carries that identical record. RED of record: the door refused it as a checkpoint,
    //    so every assertion below reported the pre-join roster for the rest of the fight.
    poll(alice, fight_record({ participants: BOTH }), 11)
    const after = project.engine_view(alice.getState())

    // the roster: bob is a seat she has
    expect(after.turn_order).toEqual(bob_view.turn_order) // all four seats, same order as his
    expect(project.board_view(alice.getState()).escrow).toHaveLength(2)
    // occupancy: his start cell is taken, so she can no longer place on top of him (5-of-6 free, not 6-of-6)
    expect(after.fighters.get(BOB)?.cell).toEqual(bob_view.fighters.get(BOB)?.cell)
    expect(after.fighters.get(BOB)?.cell).toEqual({ x: 6, y: 0 })
    // the V2 core rides the same door and reaches the same roster (chain_truth_export's home)
    expect(project_board(alice.getState().core).fighters.p1).toBeTruthy()
  })

  test("a joiner's event folds onto the seat she now has (his statuses reach her)", () => {
    const alice = client(ALICE, ALICE_ADDR)
    poll(alice, fight_record({ participants: ALONE }), 10)
    poll(alice, fight_record({ participants: BOTH }), 11)

    // bob places — a canonical, character-keyed row. Without his seat it orphans onto `c:<id>` and the
    // `p<idx>`-reading projection never sees it (inputs.js seat_resolver), which is the reported asymmetry.
    alice.getState().input({
      type: 'receipt',
      fight_id: FIGHT,
      version: 12,
      receipt: {
        events: [{ type: '0xpkg::fight_events::Placed', parsedJson: { fight: FIGHT, character: BOB, cell: 7 } }],
      },
    })

    expect(project.engine_view(alice.getState()).fighters.get(BOB)?.cell).toEqual({ x: 7, y: 0 })
  })

  test('CONTROL — an ACTIVE base is FINAL: a later object read is still an inert checkpoint (#701)', () => {
    const alice = client(ALICE, ALICE_ADDR)
    poll(alice, fight_record({ participants: ALONE, status: 1 }), 10)

    // the chain cannot produce this (join is placement-only) — it stands in for the whole stale-read class #701
    // banned: once the roster is frozen, an object read never re-folds the board.
    poll(alice, fight_record({ participants: BOTH, status: 1 }), 11)

    expect(alice.getState().core.inbox.base_version).toBe(10) // no re-adopt
    expect(project.board_view(alice.getState()).escrow).toHaveLength(1)
  })

  test('CONTROL — a solo fight is unchanged: re-reads never churn the roster', () => {
    const alice = client(ALICE, ALICE_ADDR)
    poll(alice, fight_record({ participants: ALONE }), 10)
    poll(alice, fight_record({ participants: ALONE }), 11)
    poll(alice, fight_record({ participants: ALONE }), 12)

    const view = project.engine_view(alice.getState())
    expect(view.turn_order).toEqual(['mob-0', ALICE, 'mob-1'])
    expect(project.board_view(alice.getState()).escrow).toHaveLength(1)
  })
})
