// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST regression — THE FROZEN COOLDOWN CLOCK (register #34: a side-store clock deriving domain truth from a
// transport edge, R7). The old my-turn counter lived in DungeonBoard and bumped ONLY when a POSITIVE, CHANGED
// turn_deadline_ms arrived while I was the active seat. Under lag/starvation the chain deadline lands stale /
// unchanged / zero, so that counter FROZE while last_cast_turn (stamped per committed cast) kept advancing —
// on_cooldown(last_cast, frozen_turn, cd>0) then read TRUE for every spell FOREVER (silent cast refusal, the
// armed card stuck armed, mob-only rounds). The counter now lives in the FOLD: bumped on the PLAYABLE rising edge
// (the same false→true boundary turn_started_at stamps), deadline-INDEPENDENT. This suite drives my turns through
// STALE / ZERO / UNCHANGED deadlines and proves the projected my_turn_no still advances and the REAL on_cooldown
// gate (draft-budget.js — the exact one DungeonBoard/DeckCluster read) frees a cooldown spell on schedule.
import { describe, expect, test } from 'bun:test'

import * as project from './project.js'
import { create_fight_store } from './store.js'
import { on_cooldown } from './draft_budget.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
// STATUS_PLACEMENT (5): placement resolves NO active seat, so my_turn_no stays 0 (placement never counts as a
// turn) until a TurnStarted event folds my seat active — the natural fight-open shape.
const FIGHT_OBJECT = {
  id: FIGHT,
  status: 5,
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
  mobs: [{ hp: 10, max_hp: 10, cell: 120 }],
}
const my_turn_started = (deadline_ms) => ({
  type: '0x0::fight_events::TurnStarted',
  parsedJson: { fight: FIGHT, is_mob: false, idx: 0, deadline_ms },
})
const mob_turn_started = {
  type: '0x0::fight_events::TurnStarted',
  parsedJson: { fight: FIGHT, is_mob: true, idx: 0, deadline_ms: 8_000 },
}
// The projection field both DungeonBoard and DeckCluster read via use_fight_view() → the cooldown gate's clock.
const my_turn_no = (store) => project.engine_view(store.getState())?.my_turn_no

describe('frozen cooldown clock — the seat-turn counter advances on the PLAYABLE edge, deadline-independent', () => {
  test('a my-turn that starts with a STALE/ZERO deadline still bumps my_turn_no (the starved class)', () => {
    const store = create_fight_store()
    let v = 5
    store.getState().input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR } })
    store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: v++ }, 1_000)
    expect(my_turn_no(store), 'session-init counter starts at 0 before any of my turns').toBe(0)

    // my turn 1 — a healthy positive deadline; DungeonBoard stamps last_cast_turn[sp] = fight.my_turn_no at commit.
    store.getState().input({ type: 'receipt', receipt: { events: [my_turn_started(9_000)] }, version: v++ }, 2_000)
    expect(my_turn_no(store), 'my first playable turn bumps the counter to 1').toBe(1)
    const last_cast = my_turn_no(store)

    // a mob turn — I lose the active seat (the playable edge falls)
    store.getState().input({ type: 'receipt', receipt: { events: [mob_turn_started] }, version: v++ }, 3_000)
    expect(my_turn_no(store), 'a mob turn never advances my counter').toBe(1)

    // my turn 2 — the chain hands the seat back with a STARVED (zero) deadline. The old board bump (dl>0 && changed)
    // could not fire here; the fold's playable rising edge MUST.
    store.getState().input({ type: 'receipt', receipt: { events: [my_turn_started(0)] }, version: v++ }, 4_000)
    expect(my_turn_no(store), 'a ZERO-deadline turn-start still counts as my turn (deadline-independent)').toBe(2)
    expect(
      on_cooldown(last_cast, my_turn_no(store), 1),
      'a cd-1 spell is still locked one of my turns after its cast'
    ).toBe(true)

    // a mob turn, then MY turn 3 with the SAME 9000 deadline as turn 1 — the old `dl !== counted_deadline` guard
    // would have skipped this unchanged value; the playable edge does not care about the deadline's value at all.
    store.getState().input({ type: 'receipt', receipt: { events: [mob_turn_started] }, version: v++ }, 5_000)
    store.getState().input({ type: 'receipt', receipt: { events: [my_turn_started(9_000)] }, version: v++ }, 6_000)
    expect(my_turn_no(store), 'an UNCHANGED-deadline turn-start still advances the counter to 3').toBe(3)
    expect(
      on_cooldown(last_cast, my_turn_no(store), 1),
      'the cd-1 spell is FREE again two of my turns after its cast'
    ).toBe(false)
  })

  test('regression — 12 of my turns with intermittent stale/zero deadlines: the counter never freezes; a cd-1 spell recasts on schedule every time', () => {
    const store = create_fight_store()
    let v = 5
    store.getState().input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR } })
    store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: v++ }, 1_000)
    let now = 2_000
    // a realistic lag pattern: healthy deadlines interleaved with starved zeros and repeats
    const deadlines = [9_000, 0, 8_000, 0, 0, 7_000, 0, 9_000, 0, 0, 6_000, 0]
    let last_cast = null
    let legal_casts = 0
    for (let turn = 1; turn <= 12; turn++) {
      store
        .getState()
        .input({ type: 'receipt', receipt: { events: [my_turn_started(deadlines[turn - 1])] }, version: v++ }, now)
      now += 1_000
      expect(
        my_turn_no(store),
        `my turn ${turn} advanced the counter to ${turn} despite deadline ${deadlines[turn - 1]}`
      ).toBe(turn)
      // cast the cd-1 spell whenever the gate says it is legal (turn 1, then every 2nd turn) — a frozen clock would
      // refuse every cast after the first forever.
      if (!on_cooldown(last_cast, my_turn_no(store), 1)) {
        last_cast = my_turn_no(store)
        legal_casts++
      }
      // a mob turn between mine drops the playable edge so the next my-turn is a fresh rising edge
      if (turn < 12) {
        store.getState().input({ type: 'receipt', receipt: { events: [mob_turn_started] }, version: v++ }, now)
        now += 1_000
      }
    }
    // a cd-1 spell recasts on turns 1,3,5,7,9,11 = 6 legal casts across 12 turns — never a frozen-clock false refusal.
    expect(legal_casts, 'the cd-1 spell recast on every odd turn (6 total) — the clock never froze').toBe(6)
  })
})
