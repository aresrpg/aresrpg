// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST regression for the resolve_seat INTENT lane (BACKLOG row 14 — the dead fight-prediction arm):
// a draft click dispatches a CHARACTER-keyed Moved intent (DungeonBoard.jsx optimistic_walk — the real shape:
// { kind: 'move', character, to_cell }). The store's intent door must default resolve_seat to the view-derived
// escrow lookup so the optimistic action folds onto MY SEAT (p0) and the PROJECTED me.cell moves THIS fold —
// prediction paints first, before any receipt. Before the fix the door defaulted resolve_seat to null → the
// action orphaned onto `c:<id>` (a key no projection reads) and me.cell never predicted a local draft — the
// CLIENT-INDEPENDENCE violation (prediction limped on animation beats + snapshot convergence alone).
import { describe, expect, test } from 'bun:test'

import { create_fight_store } from './store.js'
import { board_view } from './project.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const FIGHT_OBJECT = {
  // ACTIVE + my seat at the queue head: the ONLY lawful context a move intent fires (DungeonBoard gates the
  // click on input_armed = my playable turn). The provider token (INC-0) refuses a HUD push outside local_turn,
  // so the earlier arbitrary `status: 3` (a DECIDED fight) is now — correctly — a no-push phase. This models the
  // real dispatch; the assertions (fold onto p0, projected cell moves, no c:<id> orphan) are unchanged.
  status: 1,
  width: 20,
  height: 19,
  participants: [
    {
      owner: '0xaaa',
      character: CHAR,
      class: 'senshi',
      team: 0,
      ap: 6,
      mp: 3,
      base_ap: 6,
      base_mp: 3,
      hp: 50,
      max_hp: 50,
      cell: 100,
    },
  ],
  mobs: [],
}

describe('resolve_seat intent lane — a draft click predicts the projected me.cell THIS fold', () => {
  test('a character-keyed Moved intent folds onto my seat and moves the projected cell (no orphan)', () => {
    const store = create_fight_store()
    store.getState().input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR } })
    // adopt the roster (the snapshot a real fight receives on create) → escrow[0].character = CHAR
    store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
    const before = board_view(store.getState()).escrow[0].cell
    expect(before, 'precondition: the draft target must differ from the snapshot cell').not.toBe(105)
    // THE REAL DISPATCH SHAPE (DungeonBoard optimistic_walk): the click IS the move — no receipt yet
    store.getState().input({ type: 'intent', intent: { kind: 'move', character: CHAR, to_cell: 105 } }, 2_000)
    const s = store.getState()
    expect(s.fighters['c:' + CHAR], 'the intent must not orphan onto c:<id>').toBeUndefined()
    expect(s.fighters.p0?.cell, 'the optimistic Moved must fold onto MY seat').toBe(105)
    expect(board_view(s).escrow[0].cell, 'the PROJECTED me.cell moves THIS fold (prediction)').toBe(105)
  })
})
