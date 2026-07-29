// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// COOP OBSERVER DESYNC (#1140 / #1145) — HOLD-NOT-DEGRADE, the ROSTER half of the adoption gate, red-first.
//
// The snapshot door's degraded-read gate only ever asked about GEOMETRY, and it asked it as
// `fight != null && !fight_geometry_complete(fight)` — so a read that carries NO fight object at all
// (`sync_dungeon_fight({ read: null })`, the pre-engage OPEN view, and any raced/torn read that decodes to
// nothing) skipped the gate entirely and was adopted as the new base. That base has an EMPTY escrow, EMPTY mobs
// and an EMPTY turn_queue, so on the seat that ate the raced read:
//   · the turn rail iterates an empty participant set → the cards vanish mid-fight (#1140), and
//   · the committed fold has no mobs → `decided_outcome` can never resolve → `claim()` never fires → no result
//     card at fight end (#1145).
// The ACTING seat is driven by its own receipt; the OBSERVING seat is the one polling/re-reading while the peer
// holds the transaction — which is exactly why the divergence is one-sided.

import { describe, test, expect } from 'bun:test'

import { create_fight_store } from '../src/store.js'
import { engine_view, outcome_winner } from '../src/project.js'

const FIGHT = '0xc00p'
const ALICE = '0xchar_alice'
const BOB = '0xchar_bob'
const T0 = 2_000_000

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

const fight_object = () => ({
  id: FIGHT,
  status: 1,
  width: 20,
  height: 19,
  participants: [participant('0xa11ce', ALICE, 21), participant('0xb0b', BOB, 22)],
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

/** ALICE's client, mid-fight: she has adopted the two-seat active fight. */
const observing_seat = (ctx = {}) => {
  const store = create_fight_store()
  store.getState().input(
    {
      type: 'init',
      fight_id: FIGHT,
      ctx: { my_entity_id: ALICE, address: '0xa11ce', beat_ctx: { grid_width: 20 }, ...ctx },
    },
    T0
  )
  store.getState().input({ type: 'snapshot', fight: fight_object(), version: 2 }, T0 + 50)
  return store
}

// The exact message `sync_dungeon_fight` publishes for a read that produced no fight object.
const rosterless_snapshot = (version) => ({ type: 'snapshot', fight: null, fight_id: null, version })

describe('#1140 — the turn rail must survive a raced roster-less read while the peer plays', () => {
  test('WORLD coop (no run): a fight-less snapshot never replaces the adopted base — the cards stay', () => {
    const alice = observing_seat()
    expect(engine_view(alice.getState()).turn_order).toEqual([ALICE, 'mob-0', BOB])

    alice.getState().input(rosterless_snapshot(7), T0 + 900)

    const view = engine_view(alice.getState())
    expect(view).not.toBeNull()
    expect(view.turn_order).toEqual([ALICE, 'mob-0', BOB])
    expect([...view.fighters.keys()].sort()).toEqual([ALICE, BOB, 'mob-0'].sort())
  })

  test('DUNGEON coop (a run in ctx): the run-shaped OPEN stub never supersedes a live fight base either', () => {
    const alice = observing_seat({ run: { id: '0xrun', room: 1, world: '0xworld' }, rooms_total: 3 })
    expect(engine_view(alice.getState()).turn_order).toEqual([ALICE, 'mob-0', BOB])

    alice.getState().input(rosterless_snapshot(7), T0 + 900)

    expect(engine_view(alice.getState()).turn_order).toEqual([ALICE, 'mob-0', BOB])
  })
})

describe('#1145 — the result card’s open gate must survive the same raced read', () => {
  test('a fight-over an observing seat has folded stays decided after a roster-less read', () => {
    const alice = observing_seat()
    // The killing blow lands (whoever threw it — the observer folds the same rows).
    alice.getState().input(
      {
        type: 'receipt',
        receipt: {
          events: [
            ev('Hit', {
              victim_is_mob: true,
              victim_idx: 0,
              amount: 20,
              remaining_hp: 0,
              caster_is_mob: false,
              caster_idx: 1,
            }),
          ],
        },
        version: 3,
      },
      T0 + 500
    )
    expect(outcome_winner(alice.getState())).toBe(0) // client-knowable victory: the card may open

    alice.getState().input(rosterless_snapshot(7), T0 + 900)

    // Without the hold the base loses its mobs, `decided_outcome` reads "no enemy provably wiped" and returns
    // null — claim() never fires and the partner's fight ends with no surface at all.
    expect(outcome_winner(alice.getState())).toBe(0)
  })
})
