// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED PROBE (#1336 / #1137 / #1143) — the placement→active roster transition on the CREATOR's client.
//
// The measured live symptom: a second player joins the creator's world fight; the JOINER's client shows both
// seats, the CREATOR's client never does, and the fight then deadlocks on a turn whose owner the creator has no
// fighter for. The claim under test is the ruling's own acceptance: the per-turn fingerprint of two viewers of
// ONE fight is identical. Here the two viewers differ only in WHEN they bootstrapped — the creator adopted a
// placement base before the join, the joiner bootstrapped on the active read after it — which is the ordinary
// coop timeline, not an exotic race: a 4s object poll routinely straddles join+force_start.

import { describe, test, expect } from 'bun:test'

import { create_fight_store } from '../src/store.js'
import { fingerprint_state } from '../src/core.js'

const FIGHT = '0xc00p_transition'
const ALICE = '0xchar_alice'
const BOB = '0xchar_bob'
const T0 = 3_000_000

const ev = (kind, json) => ({ type: `0xpkg::fight_events::${kind}`, parsedJson: { fight: FIGHT, ...json } })

const participant = (owner, character, cell) => ({
  owner,
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

/** `status` is the ENGINE scalar: 0 = placement (the roster window), 1 = active (the roster is frozen). */
const fight_object = ({ status, seats }) => ({
  id: FIGHT,
  status,
  width: 20,
  height: 19,
  participants: seats,
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
  placement_deadline_ms: T0 + 20_000,
  world_seed: null,
  spawn_id: null,
  last_action_ms: 0,
})

const seat_of = (owner, character) => {
  const store = create_fight_store()
  store
    .getState()
    .input(
      { type: 'init', fight_id: FIGHT, ctx: { my_entity_id: character, address: owner, beat_ctx: { grid_width: 20 } } },
      T0
    )
  return store
}

const roster_ids = (store) =>
  fingerprint_state(store.getState().core)
    .roster.map((row) => row.id)
    .sort()

// The transition the chain actually emits between the two object reads: the fight left placement and the first
// turn opened. It reaches an observing seat over the JOURNAL wire (`{ kind, data, seq, version }`, the SSE/pager
// row shape) and is the creator's PROOF that the placement window closed.
const transition_batch = () => ({
  head: 4,
  events: [
    {
      kind: 'TurnStarted',
      seq: 4,
      version: 3,
      data: { fight: FIGHT, is_mob: false, idx: 0, deadline_ms: T0 + 60_000 },
    },
  ],
})

describe('coop roster transition — the creator must adopt the seat that joined', () => {
  test('CREATOR adopts a joiner introduced by the active read that closed the placement window', () => {
    const alice = seat_of('0xa11ce', ALICE)
    // v1 — alice creates and adopts the placement base ALONE (the joiner has not landed yet).
    alice.getState().input(
      {
        type: 'snapshot',
        fight: fight_object({ status: 0, seats: [participant('0xa11ce', ALICE, 21)] }),
        version: 1,
      },
      T0 + 10
    )
    expect(roster_ids(alice)).toEqual([ALICE, 'mob-0'].sort())

    // bob joins at v2 — alice's 4s poll never sampled that placement read (join + force_start inside one window).
    // v3 arrives ACTIVE, carrying the frozen roster: alice AND bob. Its transition is proven by the event tail.
    alice.getState().input({ type: 'journal', fight_id: FIGHT, batch: transition_batch(), version: 3 }, T0 + 4_000)
    const started = fight_object({
      status: 1,
      seats: [participant('0xa11ce', ALICE, 21), participant('0xb0b', BOB, 22)],
    })
    alice.getState().input({ type: 'snapshot', fight: started, version: 3 }, T0 + 4_010)

    // THE RED: the creator plays a 2-seat fight with a 1-seat roster — the turn rail names a fighter it has no
    // row for (the deadlock), and every peer status/buff lands on a seat that does not exist for this viewer.
    expect(roster_ids(alice)).toEqual([ALICE, BOB, 'mob-0'].sort())
  })

  test('FINGERPRINT PARITY: creator and joiner publish the same image of the same frontier', () => {
    const alice = seat_of('0xa11ce', ALICE)
    const bob = seat_of('0xb0b', BOB)
    alice.getState().input(
      {
        type: 'snapshot',
        fight: fight_object({ status: 0, seats: [participant('0xa11ce', ALICE, 21)] }),
        version: 1,
      },
      T0 + 10
    )
    const started = fight_object({
      status: 1,
      seats: [participant('0xa11ce', ALICE, 21), participant('0xb0b', BOB, 22)],
    })
    for (const store of [alice, bob]) {
      store.getState().input({ type: 'journal', fight_id: FIGHT, batch: transition_batch(), version: 3 }, T0 + 4_000)
      store.getState().input({ type: 'snapshot', fight: started, version: 3 }, T0 + 4_010)
    }
    // POSITIVE CONTROL — the detector fires on a genuinely forked state (bob alone never saw the fight start).
    const naive = seat_of('0xb0b', BOB)
    expect(JSON.stringify(fingerprint_state(naive.getState().core))).not.toBe(
      JSON.stringify(fingerprint_state(bob.getState().core))
    )
    // …and is silent between two honest viewers of one frontier.
    expect(JSON.stringify(fingerprint_state(alice.getState().core))).toBe(
      JSON.stringify(fingerprint_state(bob.getState().core))
    )
  })
})
