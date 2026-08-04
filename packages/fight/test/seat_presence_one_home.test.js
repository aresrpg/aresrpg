// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #2210 — "is my seat in the fight read" has ONE home: the board projection.
//
// It used to have three, and they already disagreed. The frontend's `world_fight_receipt.my_seat_present`
// matched roster rows on `participant_character_id`, which has NO address fallback, while every fold/projection
// home matches on `participant_entity_id`, which does. A seat that is addr-keyed — a row whose character is not
// in the read yet — therefore MISSED in the frontend home and MATCHED in the core's, and that wrong-false is not
// a cosmetic disagreement: `fight_syncing` is cleared only by this predicate, so the joiner's syncing chip hangs
// forever (the #2154 symptom inverted — the fix for "the chip clears too late" minted a way for it never to clear).
//
// The divergence is pinned here BY ITS MECHANISM (the two matchers named on one row), so a future home that
// re-derives seat presence on the character-only predicate is red for the reported reason, not by coincidence.

import { expect, test } from 'bun:test'

import { participant_character_id, participant_entity_id } from '../src/participant_identity.js'
import { board_view } from '../src/project.js'
import { create_fight_store } from '../src/store.js'

const FIGHT = '0xfight'
const ME = '0xchar_me'
const MY_ADDR = '0xme'
const PEER = '0xchar_peer'
const T0 = 2_000_000

/** A chain participant as the Fight object carries it. `character` omitted ⇒ the addr-keyed seat. */
const participant = ({ owner, character = undefined, cell }) => ({
  owner,
  ...(character === undefined ? {} : { character }),
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
})

const fight_object = (participants) => ({
  id: FIGHT,
  status: 1,
  width: 20,
  height: 19,
  participants,
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
  turn_entropy: T0 + 30_000,
  turn_ordinal: 1,
  placement_deadline_ms: 0,
  world_seed: null,
  spawn_id: null,
  last_action_ms: 0,
})

/** The projection a seated client publishes: `my_entity_id` is the seat it is converging on, never a read of it. */
const projected_board = (participants, { my_entity_id = ME, spectator = false } = {}) => {
  const store = create_fight_store()
  store.getState().input(
    {
      type: 'init',
      fight_id: FIGHT,
      ctx: { my_entity_id, address: MY_ADDR, spectator, beat_ctx: { grid_width: 20 } },
    },
    T0
  )
  store.getState().input({ type: 'snapshot', fight: fight_object(participants), version: 2 }, T0 + 50)
  return board_view(store.getState())
}

test('#2154 preserved: a readable board without my seat is not convergence, one with it is', () => {
  const without_me = projected_board([participant({ owner: '0xcreator', character: PEER, cell: 21 })])
  expect(without_me.my_seat_present, 'the read that logs my_entity_missing_from_fighters').toBe(false)

  const with_me = projected_board([
    participant({ owner: '0xcreator', character: PEER, cell: 21 }),
    participant({ owner: MY_ADDR, character: ME, cell: 22 }),
  ])
  expect(with_me.my_seat_present).toBe(true)
})

test('#2210 the addr-keyed seat: the character-only matcher misses it, the projection sees it', () => {
  const addr_seat = participant({ owner: MY_ADDR, cell: 22 })
  const board = projected_board([participant({ owner: '0xcreator', character: PEER, cell: 21 }), addr_seat], {
    my_entity_id: MY_ADDR,
  })
  const row = board.escrow.find((seat) => seat.addr === MY_ADDR)

  // THE MECHANISM, on one row: the two matchers disagree, and only one of them is the fold's identity.
  expect(participant_character_id(row), 'no character row has landed yet').toBe(null)
  expect(participant_entity_id(row), 'the identity the whole fold keys on falls back to the address').toBe(MY_ADDR)
  // The dead frontend home matched on the first and would hang `fight_syncing` here forever.
  expect(board.my_seat_present, 'my seat IS in this read').toBe(true)
})

test('a session holding no seat of its own converges on any readable board', () => {
  const roster = [participant({ owner: '0xcreator', character: PEER, cell: 21 })]
  expect(projected_board(roster, { my_entity_id: null }).my_seat_present).toBe(true)
  expect(projected_board(roster, { my_entity_id: null, spectator: true }).my_seat_present).toBe(true)
  // A spectator that still carries a stale character id holds no seat to wait for either.
  expect(projected_board(roster, { my_entity_id: ME, spectator: true }).my_seat_present).toBe(true)
})

test('the roster rows name their own identity, so no consumer re-derives it', () => {
  const board = projected_board([
    participant({ owner: '0xcreator', character: PEER, cell: 21 }),
    participant({ owner: MY_ADDR, cell: 22 }),
  ])
  expect(board.escrow.map((row) => row.id)).toEqual([PEER, MY_ADDR])
})
