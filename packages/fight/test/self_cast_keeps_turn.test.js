// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #323 — "turn auto-ends right after a cast; the MP phase robbed". This SETTLES the auto-end mechanism with
// evidence: casting a self-buff (invisibility/vanish) does NOT end the turn locally, and a tick with the turn's
// real (far) deadline does NOT auto-commit. So there is NO cast-driven auto-end and NO AP-exhaustion auto-pass
// (searched the tree — none exists); the ONLY auto-end is the DEADLINE auto-commit (store.js commit_due =
// deadline_due || kill_due). The reported "auto-end right after a cast" is that deadline commit firing on the
// first draft while the visible timer over-promised the window (fixed honestly in FightControls) — the cast is
// merely what created a batch for the already-due commit to ship. The granted MP stays spendable this turn
// (the #332 budget projection), so the MP phase is preserved until the player's own End Turn / the deadline.
import { describe, expect, test } from 'bun:test'

import { committed_truth, create_fight_store, presented_state } from '../src/store.js'

const GRID_W = 20
const FIGHT = '0xf1'
const CHAR = '0xc1'
const cell = (x, y) => y * GRID_W + x
const START = cell(5, 5)
const FIGHT_OBJECT = {
  id: FIGHT,
  status: 1,
  width: GRID_W,
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
      cell: START,
      stats: { agility: 0 },
    },
  ],
  mobs: [{ template: '0xabc', hp: 30, max_hp: 30, cell: cell(15, 15), ap: 4, mp: 3, level: 1, stats: { agility: 0 } }],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
  turn_entropy: 90_000,
  turn_ordinal: 1, // a long, healthy turn window — nowhere near the 5s auto-commit buffer
}
const boot = () => {
  const store = create_fight_store()
  store.getState().input({
    type: 'init',
    fight_id: FIGHT,
    my_key: 'p0',
    ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: GRID_W } },
  })
  store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
  store.getState().input({ type: 'arm', spell_id: 'weapon' }, 1_000)
  return store
}
// Vanish: a self-cast on the caster's own cell (rmax 0) + its +1 MP grant — the exact optimistic composite the
// board dispatches (predict_cast → 'predicted').
const vanish_predicted = (target) => ({
  type: 'predicted',
  basis_version: 6,
  actions: [
    { kind: 'Cast', caster_is_mob: false, caster_idx: 0, target_cell: target, damaging: false },
    { kind: 'Granted', target_is_mob: false, target_idx: 0, point_kind: 1, granted: 1 },
  ],
})

describe('#323 a self-cast keeps the turn open — the auto-end is the deadline, never the cast', () => {
  test('it is my turn before the cast (precondition)', () => {
    const store = boot()
    expect(committed_truth(store.getState()).active).toBe('p0')
  })

  test('casting a self-buff does NOT end my turn — active stays mine, granted MP is spendable', () => {
    const store = boot()
    store.getState().input(vanish_predicted(START), 2_000)
    // the turn is STILL mine (no implicit end-turn) …
    expect(committed_truth(store.getState()).active).toBe('p0')
    // … and the +1 MP the buff granted is live on the presented pool (spendable this turn — the MP phase held).
    expect(presented_state(store.getState()).fighters.p0.mp).toBe(4)
  })

  test('a tick on the real (far) deadline never auto-commits after the cast', () => {
    const store = boot()
    store.getState().input(vanish_predicted(START), 2_000)
    store.getState().input({ type: 'tick', draft_count: 1 }, 3_000) // long before deadline − buffer (85_000)
    expect(store.getState().commit_due).toBe(false) // NOT robbed — the turn stays open until End Turn / the deadline
    expect(committed_truth(store.getState()).active).toBe('p0')
  })
})
