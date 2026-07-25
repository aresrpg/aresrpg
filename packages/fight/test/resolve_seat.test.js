// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST regression for D-resolve_seat (over-engineering advisor 07-16): a CHARACTER-keyed Moved event must
// fold onto the player's SEAT (p0), never orphan onto c:<id>. Before the fix the store's input door defaulted
// resolve_seat to null, so the projected me.cell (the p<idx> seat) never reflected a local OR committed
// placement/move — the prediction+commit fold was silently dead (the boot-from-0 red: me.cell 0:0 ≠ placed 5:0).
import { describe, expect, test } from 'bun:test'

import { create_fight_store } from '../src/store.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
// Minimal Fight OBJECT: one participant = my character at seat 0 → board_state_from_fight builds escrow[0].character.
const FIGHT_OBJECT = {
  id: FIGHT,
  status: 3,
  width: 20,
  height: 19,
  participants: [{ owner: '0xaaa', character: CHAR, class: 'senshi', team: 0 }],
  mobs: [],
}
const moved_receipt = { type: '0x0::fight_events::Moved', parsedJson: { fight: FIGHT, character: CHAR, to_cell: 50 } }

describe('resolve_seat — character-keyed events fold onto the seat, not an orphan', () => {
  test('a Moved keyed by my character updates my SEAT cell (not orphaned to c:<id>)', () => {
    const store = create_fight_store()
    store.getState().input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR } })
    // adopt the roster (the snapshot a real fight receives on create) → escrow[0].character = CHAR
    store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
    // a CHARACTER-keyed authoritative Moved (the exact shape place_at / commit_turn receipts carry for MY seat)
    store.getState().input({ type: 'receipt', receipt: { events: [moved_receipt] }, version: 6 }, 2_000)
    const s = store.getState()
    expect(s.fighters.p0?.cell, 'my character-keyed Moved must fold onto seat p0').toBe(50)
    expect(s.fighters['c:' + CHAR], 'no orphan c:<id> seat may exist').toBeUndefined()
  })

  // RED-FIRST for the DROPPED `Placed` fold (advisor 07-16b): turns.move emits Placed{character, cell}
  // (fight_events.move:22) but apply_action had NO Placed case → the placed cell was dropped, so me.cell stayed at
  // the default (the boot-from-0 red: post-READY me.cell 0:0 ≠ placed 5:0). The Placed case must fold cell→seat.
  test('a Placed keyed by my character folds the placed cell onto my seat', () => {
    const store = create_fight_store()
    store.getState().input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR } })
    store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
    const placed = { type: '0x0::fight_events::Placed', parsedJson: { fight: FIGHT, character: CHAR, cell: 88 } }
    store.getState().input({ type: 'receipt', receipt: { events: [placed] }, version: 6 }, 2_000)
    const s = store.getState()
    expect(s.fighters.p0?.cell, 'my Placed must fold the placed cell onto seat p0 (not be dropped)').toBe(88)
    expect(s.fighters['c:' + CHAR], 'no orphan c:<id> seat may exist').toBeUndefined()
  })
})
