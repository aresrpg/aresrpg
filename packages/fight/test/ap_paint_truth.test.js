// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// AP-PAINT TRUTH — a live symptom where the AP display didn't decrement after a cast, so spells stayed
// clickable past the true budget while the underlying reducer already blocked the cast: a desync between
// two systems computing AP independently. Ratified diagnosis: TWO homes for one fact.
//
//  half 1 — THE SPEND NEVER FOLDED: the ONE reducer had no AP-debit arm, so a drafted cast left the
//    projected budget at the refill value all turn (the display's 6 AP) while DungeonBoard's component-local
//    draft math said "can't afford" — literally two systems fighting. The optimistic cast intent now carries
//    its ap_cost (moves: mp_cost) and apply_action debits the caster — prediction through the same fold,
//    purged/reconciled by the receipt + object read like every other intent.
//  half 2 — THE MIRROR LAGGED: every HUD read went through the game-core `state.fight` copy, recomputed on
//    core change but pumped through game.js's ASYNC action stream — ≥1 dispatch cycle stale, forever. The
//    mirror is DELETED: HUD components subscribe to the core (use_fight_view/fight_view) and read the
//    projection SYNCHRONOUSLY; `state.fight` must never exist again.
//
// RED (2026-07-17, pre-fix, raw): half 1 — `ap stays the refill value: expected 2, received 6`;
// half 2 asserted the then-HUD surface (context.get_state().fight) same-tick — stale by the async pump.
// GREEN: the debit folds same-tick on the core surface, and the mirror key is gone from game-core state.

import { describe, expect, test } from 'bun:test'

import { create_fight_store } from '../src/store.js'
import { engine_view } from '../src/project.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'

const FIGHT_OBJECT = {
  id: FIGHT,
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
  mobs: [{ template: '0xabc', hp: 30, max_hp: 30, cell: 105, ap: 4, mp: 3, level: 1 }],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
}

const boot = () => {
  const store = create_fight_store()
  store.getState().input({
    type: 'init',
    fight_id: FIGHT,
    my_key: 'p0',
    ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: 20 } },
  })
  store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
  return store
}

describe('AP-paint truth — the budget the HUD renders IS the folded spend, same tick', () => {
  test('a local cast intent carrying its ap_cost debits the projected AP the same synchronous tick', () => {
    const store = boot()
    // the AP surface every HUD consumer reads (Vitals pips, DeckCluster affordability, the readout):
    const hud_ap = () => engine_view(store.getState()).fighters.get(CHAR).ap
    expect(hud_ap(), 'turn-start budget paints from the snapshot').toBe(6)
    // MY drafted cast, exactly as DungeonBoard.optimistic_cast dispatches it — the intent carries the cost.
    store
      .getState()
      .input({ type: 'intent', intent: { kind: 'cast', target_cell: 105, damaging: true, ap_cost: 4 } }, 2_000)
    expect(hud_ap(), 'ap stays the refill value').toBe(2) // ← the flagship: spent AP paints THIS tick
  })

  test('a local move intent carrying the absolute mp_left adopts it the same synchronous tick (undo restores)', () => {
    const store = boot()
    const hud_mp = () => engine_view(store.getState()).fighters.get(CHAR).mp
    expect(hud_mp()).toBe(3)
    store
      .getState()
      .input({ type: 'intent', intent: { kind: 'move', character: CHAR, to_cell: 102, mp_left: 1 } }, 2_000)
    expect(hud_mp(), 'mp stays the refill value').toBe(1)
    // the undo walk re-raises the ABSOLUTE remainder — the projected budget restores honestly.
    store
      .getState()
      .input({ type: 'intent', intent: { kind: 'move', character: CHAR, to_cell: 100, mp_left: 3 } }, 2_100)
    expect(hud_mp(), 'an undone step restores the budget').toBe(3)
  })

  test('an authoritative receipt purges the optimistic debit and the snapshot value rules again', () => {
    const store = boot()
    store
      .getState()
      .input({ type: 'intent', intent: { kind: 'cast', target_cell: 105, damaging: true, ap_cost: 4 } }, 2_000)
    expect(engine_view(store.getState()).fighters.get(CHAR).ap).toBe(2)
    // the commit's receipt at version 6 — the whole statement of the turn; intents at/below it purge.
    store.getState().input(
      {
        type: 'receipt',
        version: 6,
        events: [
          { type: '0x0::fight_events::Cast', parsedJson: { fight: FIGHT, caster_is_mob: false, caster_idx: 0 } },
        ],
      },
      3_000
    )
    // the receipt's events carry no ap; the projection falls back to the AUTHORITATIVE snapshot row (6 until
    // the post-commit object read adopts the chain-debited value) — never a stuck optimistic number.
    expect(engine_view(store.getState()).fighters.get(CHAR).ap).toBe(6)
  })

  test('receipt Cast events (no ap_cost) never debit — chain reconcile stays the one authority', () => {
    const store = boot()
    store.getState().input(
      {
        type: 'receipt',
        version: 6,
        events: [
          { type: '0x0::fight_events::Cast', parsedJson: { fight: FIGHT, caster_is_mob: false, caster_idx: 0 } },
        ],
      },
      2_000
    )
    expect(engine_view(store.getState()).fighters.get(CHAR).ap).toBe(6)
  })
})
