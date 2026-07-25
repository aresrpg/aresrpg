// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, test, expect } from 'bun:test'

import { apply_action, empty_state, normalize_events } from '../src/inputs.js'
import { create_fight_store } from '../src/store.js'

// REGRESSION STUB — optimistic invisibility reveal (FIGHTREAL delta#1). The chain reveals a hidden fighter on any
// DAMAGING attack via `aresrpg_spells::statuses::reveal` (cast.move:164/291/372/414) but emits NO event (FIGHTREAL:
// 0 StanceChanged on chain for a reveal). So the client can't wait for an event — the core's reducer MIRRORS the
// Move rule: a damaging Cast clears the caster's invisibility. On MY cast that is optimistic (this frame, no
// round-trip); on a peer's it is inferred from the receipt (a Cast followed by a Hit on someone other than the caster).

const PKG = '0xa11ce5_pkg_synthetic'
const FIGHT = '0xf16h7_synthetic'
const ev = (name, json) => ({ type: `${PKG}::fight_events::${name}`, parsedJson: { fight: FIGHT, ...json } })

describe('invisibility reveal — mirror of statuses::reveal', () => {
  test('my own damaging cast reveals me THIS frame (optimistic, no receipt)', () => {
    const store = create_fight_store()
    store.getState().input({ type: 'init', fight_id: FIGHT, my_key: 'p0' })
    store.getState().input(
      {
        type: 'receipt',
        receipt: { events: [ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: 0 })] },
        version: 1,
      },
      0
    )
    store.getState().input(
      {
        type: 'receipt',
        // real chain shape (fight_events StanceChanged{fighter_*, stance, active}); stance 27 = invisibility
        receipt: { events: [ev('StanceChanged', { fighter_is_mob: false, fighter_idx: 0, stance: 27, active: true })] },
        version: 2,
      },
      0
    )
    expect(store.getState().fighters.p0.invisible).toBe(true)
    store
      .getState()
      .input({ type: 'intent', intent: { kind: 'cast', target_cell: 5, damaging: true }, version: 3, event_idx: 0 }, 0)
    expect(store.getState().fighters.p0.invisible).toBe(false)
  })

  test('a NON-damaging cast does not reveal', () => {
    let s = empty_state(FIGHT)
    s = apply_action(s, { kind: 'StanceChanged', fighter_is_mob: false, fighter_idx: 0, stance: 27, active: true })
    s = apply_action(s, { kind: 'Cast', caster_is_mob: false, caster_idx: 0, target_cell: 5, damaging: false })
    expect(s.fighters.p0.invisible).toBe(true)
  })

  test('receipt: a peer damaging cast (Cast → Hit on another) reveals the caster', () => {
    let s = empty_state(FIGHT)
    s = apply_action(s, { kind: 'StanceChanged', fighter_is_mob: true, fighter_idx: 0, stance: 27, active: true })
    expect(s.fighters.m0.invisible).toBe(true)
    const actions = normalize_events(
      {
        events: [
          ev('Cast', { caster_is_mob: true, caster_idx: 0, target_cell: 5 }),
          ev('Hit', { victim_is_mob: false, victim_idx: 0, amount: 3, remaining_hp: 10 }),
        ],
      },
      { version: 2, fight_id: FIGHT }
    )
    s = actions.reduce(apply_action, s)
    expect(s.fighters.m0.invisible).toBe(false)
  })
})
