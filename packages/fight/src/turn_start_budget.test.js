// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST regression for the TURN-START BUDGET (advisor pass-19, the client-independence / ONE-PIPELINE law).
// On-chain, begin_turn refills a seat's ap/mp to base the instant its turn lands (participant.move:220-224), but the
// TurnStarted event (fight_events.move:24) carries NO ap/mp — and the fight fold had no ap/mp vocabulary at all
// (empty_fighter / the TurnStarted case never touched them). So the projected budget stayed the STALE pre-refill
// snapshot (0) until the next Fight-object read landed → a live-looking turn ("active" folds from the fast event)
// with a DEAD move/cast range (mp/ap read 0) → the v1.12.28-class dead opening click (diag: active_is_me=true,
// engine_me_mp=0, escrow_mp=0, the click landed on the exact cell). The fold must gain ap/mp and the TurnStarted
// normalize door must inject the base refill so the budget predicts THIS frame; the object snapshot reconciles it
// for FREE (the existing entries-prune drops this overlay once a post-refill read adopts → project.js f.mp ?? row.mp
// falls back to the authoritative snapshot, so a genuinely AP/MP-drained seat stays correct).
import { describe, expect, test } from 'bun:test'

import { create_fight_store } from './store.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
// A seat whose turn is about to start: the last adopted snapshot still holds the pre-begin_turn budget (ap:0, mp:0);
// base_ap/base_mp are the refill the chain guarantees at begin_turn. (Mirrors the escrow shape board_state builds.)
const FIGHT_OBJECT = {
  id: FIGHT,
  status: 3,
  width: 20,
  height: 19,
  participants: [
    {
      owner: '0xaaa',
      character: CHAR,
      class: 'senshi',
      team: 0,
      ap: 0,
      mp: 0,
      base_ap: 6,
      base_mp: 3,
      hp: 50,
      max_hp: 50,
      cell: 100,
    },
  ],
  mobs: [],
}
const turn_started = {
  type: '0x0::fight_events::TurnStarted',
  parsedJson: { fight: FIGHT, is_mob: false, idx: 0, deadline_ms: 9000 },
}

describe('turn-start budget — TurnStarted predicts the begin_turn ap/mp refill', () => {
  test('my seat folds base_ap/base_mp at turn-start, not the stale pre-refill snapshot 0', () => {
    const store = create_fight_store()
    store.getState().input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR } })
    store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
    // precondition (the bug's setup): the raw adopted snapshot budget IS the pre-refill 0
    expect(store.getState().view.escrow[0].mp, 'snapshot escrow must carry the pre-refill mp=0').toBe(0)
    // the seat's turn starts — the event carries NO ap/mp, so the fold must inject the base refill
    store.getState().input({ type: 'receipt', receipt: { events: [turn_started] }, version: 6 }, 2_000)
    const s = store.getState()
    expect(s.fighters.p0?.mp, 'the fold must predict base_mp at turn-start (was: no ap/mp vocabulary → stale 0)').toBe(
      3
    )
    expect(s.fighters.p0?.ap, 'the fold must predict base_ap at turn-start').toBe(6)
  })
})
