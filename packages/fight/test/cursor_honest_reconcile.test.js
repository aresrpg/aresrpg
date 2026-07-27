// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// RED-FIRST — a Fight OBJECT read may only replace the fold when its journal cursor proves it is not behind.
// Object version is not that proof: a late placement read can carry a higher object version while its journal_head
// predates events this client already folded. Re-adopting it raises the snapshot floor over those events while the
// accept cursor still calls them consumed, permanently deleting their facts from both the board and later backfill.

import { describe, expect, test } from 'bun:test'

import { K_INVISIBILITY, SHAPE_POINT, TF_ONLY_CASTER } from '../../sim/src/spell_effect.js'
import { committed_truth, create_fight_store } from '../src/store.js'

const FIGHT = '0xcursor_honest'
const ALICE = '0xa11ce'
const BOB = '0xb0b'
const START = 25
const MOVED = 29
const PKG = '0xpkg::fight_events::'

const participant = (character, cell) => ({
  owner: character === ALICE ? '0xalice' : '0xbob',
  character,
  class: 'yajin',
  team: 0,
  hp: 50,
  max_hp: 50,
  ap: 6,
  mp: 3,
  base_ap: 6,
  base_mp: 3,
  cell,
  ready: false,
})

const mob = (cell) => ({
  template: '0xmob',
  level: 2,
  hp: 40,
  max_hp: 40,
  ap: 4,
  mp: 3,
  cell,
})

const placement_fight = ({
  alice_cell = START,
  participants = [participant(ALICE, alice_cell), participant(BOB, 26)],
  mobs = [mob(200), mob(201)],
} = {}) => ({
  id: FIGHT,
  status: 0,
  width: 12,
  height: 12,
  participants,
  mobs,
  queue: [],
  turn_ptr: 0,
  turn_deadline_ms: 0,
  placement_deadline_ms: 90_000,
  start_cells_a: [START, 26],
  start_cells_b: [200, 201],
  obstacles: [],
  holes: [],
  shape_mask: [],
  // Explicit empty is intentional: this is the lagging read that used to clobber the receipt-folded status.
  invisibility_statuses: [],
})

const action = {
  fight: FIGHT,
  caster_is_mob: false,
  caster_idx: 0,
  turn_ordinal: '1',
  action_ordinal: '0',
}

const effect = {
  kind: K_INVISIBILITY,
  element: 255,
  value: 1,
  area_shape: SHAPE_POINT,
  area_size: 0,
  target_filter: TF_ONLY_CASTER,
  chance: 100,
  turns: 3,
  stat: 0,
  flags: 0,
  phase: 0,
}

const EVENT_ROWS = [
  {
    kind: 'ActionStarted',
    data: { ...action, action_kind: 0, target_cell: START, ap_cost: 2, effect_count: 1 },
  },
  {
    kind: 'ActionEffect',
    data: { ...action, effect_ordinal: 0, effect },
  },
  {
    kind: 'Cast',
    data: { fight: FIGHT, caster_is_mob: false, caster_idx: 0, target_cell: START },
  },
  {
    kind: 'Moved',
    data: { fight: FIGHT, character: ALICE, to_cell: MOVED },
  },
]

const receipt = {
  type: 'receipt',
  fight_id: FIGHT,
  version: 2,
  receipt: {
    digest: '0xcursor',
    events: EVENT_ROWS.map((row) => ({ type: PKG + row.kind, parsedJson: row.data })),
  },
}

const journal = {
  type: 'journal',
  fight_id: FIGHT,
  batch: {
    source: 'journal',
    fight_id: FIGHT,
    head: String(EVENT_ROWS.length),
    events: EVENT_ROWS.map((row, seq) => ({
      seq: String(seq),
      version: '2',
      kind: row.kind,
      data: row.data,
      digest: '0xcursor',
      source: 'journal',
    })),
  },
}

const facts = (store) => {
  const state = store.getState()
  const truth = committed_truth(state)
  return {
    cell: truth.fighters.p0?.cell,
    buff: truth.fighters.p0?.statuses?.some((row) => Number(row.kind) === K_INVISIBILITY) ?? false,
    roster: Object.keys(truth.fighters).sort(),
    view_version: state.view_version,
    base_version: state.core.inbox.base_version,
  }
}

describe('cursor-honest Fight-object reconciliation', () => {
  test('a snapshot behind the accepted cursor cannot clobber a folded buff, cell, or roster', () => {
    const store = create_fight_store()
    store.getState().input({
      type: 'init',
      fight_id: FIGHT,
      my_key: 'p0',
      ctx: { my_entity_id: ALICE, beat_ctx: { grid_width: 20 } },
    })
    store.getState().input({ type: 'snapshot', fight: placement_fight(), version: 1, journal_head: '0' }, 1_000)
    store.getState().input(receipt, 1_100)

    const accepted = store.getState().accept_state.head
    const folded = facts(store)
    expect(accepted).toBe('3')
    expect(folded).toEqual({
      cell: MOVED,
      buff: true,
      roster: ['m0', 'm1', 'p0', 'p1'],
      view_version: 1,
      base_version: 1,
    })

    // Its object version is higher, but journal_head=0 is behind accepted_next=4. The read is also visibly stale:
    // Alice is back at START, Bob and one mob are missing, and the active status set is empty.
    store.getState().input(
      {
        type: 'snapshot',
        fight: placement_fight({
          alice_cell: START,
          participants: [participant(ALICE, START)],
          mobs: [mob(200)],
        }),
        version: 3,
        journal_head: '0',
      },
      1_200
    )

    expect(store.getState().accept_state.head, 'discarding a read must not move the accepted event cursor').toBe(
      accepted
    )
    expect(facts(store), 'the cursor-behind object read must be inert').toEqual(folded)

    // The authoritative journal later redelivers the exact rows. They dedupe at the unchanged cursor and must leave
    // the same fold standing; they cannot be required to resurrect facts a stale snapshot was allowed to erase.
    store.getState().input(journal, 1_300)
    expect(store.getState().accept_state.head).toBe(accepted)
    expect(facts(store)).toEqual(folded)
  })

  test('a cursor-ahead snapshot re-adopts whole and re-seeds the event cursor', () => {
    const store = create_fight_store()
    store.getState().input({
      type: 'init',
      fight_id: FIGHT,
      my_key: 'p0',
      ctx: { my_entity_id: ALICE, beat_ctx: { grid_width: 20 } },
    })
    store.getState().input({ type: 'snapshot', fight: placement_fight(), version: 1, journal_head: '0' }, 1_000)
    store.getState().input(receipt, 1_100)

    // head=5 proves this object contains one event beyond the four already accepted. Its roster/status/cell values
    // replace the base as one unit; retaining selected fields from the prior fold would manufacture chain state.
    store.getState().input(
      {
        type: 'snapshot',
        fight: placement_fight({
          alice_cell: START,
          participants: [participant(ALICE, START)],
          mobs: [mob(200)],
        }),
        version: 3,
        journal_head: '5',
      },
      1_200
    )

    expect(store.getState().accept_state.head).toBe('4')
    expect(facts(store)).toEqual({
      cell: START,
      buff: false,
      roster: ['m0', 'p0'],
      view_version: 3,
      base_version: 3,
    })
  })
})
