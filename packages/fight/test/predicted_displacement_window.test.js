// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ③ PREDICTED-DISPLACEMENT WINDOW (ruled 2026-07-19, option a): a predicted Displaced is the SAME class as a
// Moved intent — a mover whose motion beat is in flight — so display_state must HOLD the victim at the pre-push
// cell until the predicted slide beat presents (the walk-window d4f9e748 mechanism, EXTENDED not forked). The
// effective (presented) projection still sees the destination (draft legality unblocked, exactly like walks).
// RED at HEAD: the predicted Displaced paints the destination the instant it folds (the slide fires "too early" —
// the rig teleports before the slide animates).

import { describe, expect, test } from 'bun:test'

import { create_fight_store, presented_state } from '../src/store.js'
import { board_view } from '../src/project.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const GRID_W = 20
const cell = (x, y) => y * GRID_W + x
const ME_CELL = cell(5, 2)
const MOB_CELL = cell(5, 5)
const MOB_DEST = cell(8, 5)

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
      cell: ME_CELL,
    },
  ],
  mobs: [{ template: '0xabc', hp: 30, max_hp: 30, cell: MOB_CELL, ap: 4, mp: 3, level: 1 }],
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
    ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: GRID_W } },
  })
  store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
  return store
}
const board_mob_cell = (store) => board_view(store.getState()).mobs[0].cell

describe('③ a predicted push windows the victim: display holds the pre-push cell until the slide presents', () => {
  const dispatch_push = (store) =>
    store.getState().input(
      {
        type: 'predicted',
        basis_version: 6,
        intent_id: 'push1',
        actions: [
          { kind: 'Cast', caster_is_mob: false, caster_idx: 0, target_cell: MOB_CELL, ap_cost: 3 },
          { kind: 'Displaced', target_is_mob: true, target_idx: 0, to_cell: MOB_DEST },
        ],
        beats: [
          { kind: 'cast', at: 0, duration: 100, payload: {} },
          { kind: 'displacement', at: 100, duration: 200, payload: { target_id: 'mob-0', to: { x: 8, y: 5 } } },
        ],
      },
      1_100
    )

  test('the victim holds at the pre-push cell in DISPLAY while EFFECTIVE already sees the destination', () => {
    const store = boot()
    dispatch_push(store)
    // DISPLAY holds the victim at the pre-push cell while the slide beat is in flight (HEAD paints MOB_DEST here).
    expect(board_mob_cell(store)).toBe(MOB_CELL)
    // EFFECTIVE already sees the destination — draft legality/reach unblocked, same split as a walk.
    expect(presented_state(store.getState()).fighters.m0.cell).toBe(MOB_DEST)
    // After the slide turn acks, the victim arrives.
    const push_turn = store.getState().wave.find((t) => t.is_local)
    store.getState().input({ type: 'presented', seq: push_turn.seq }, 2_000)
    expect(board_mob_cell(store)).toBe(MOB_DEST)
  })

  test('a predicted cast with NO displacement carries NO window (B3 — effects paint this frame)', () => {
    const store = boot()
    store.getState().input(
      {
        type: 'predicted',
        basis_version: 6,
        intent_id: 'cast1',
        actions: [
          { kind: 'Cast', caster_is_mob: false, caster_idx: 0, target_cell: MOB_CELL, ap_cost: 3 },
          { kind: 'Hit', victim_is_mob: true, victim_idx: 0, amount: 10, remaining_hp: 20 },
        ],
        beats: [{ kind: 'cast', at: 0, duration: 100, payload: {} }],
      },
      1_100
    )
    const turn = store.getState().wave.find((t) => t.is_local)
    expect(turn.from_idx == null).toBe(true) // no displacement ⇒ no window
    expect(board_view(store.getState()).mobs[0].hp).toBe(20) // damage paints this frame
  })
})
