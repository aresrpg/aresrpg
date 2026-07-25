// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ③b RECEIPT DISPLACEMENT-LEG DEDUPE (ruled 07-19): the prediction predicts the slide (client-independence) and
// windows it; when the receipt for MY OWN turn arrives, its displacement_leg is RECONCILED in the fold —
// a receipt displacement MATCHING the already-presented predicted displacement (same target + same to_cell) is
// DISCARDED (no double-play), a MISMATCH plays the receipt leg as the correction (chain truth adopts; never
// regress a receipt-proven fact). RED at HEAD: the matching receipt still emits a redundant second slide.

import { describe, expect, test } from 'bun:test'

import { create_fight_store } from '../src/store.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const GRID_W = 20
const cell = (x, y) => y * GRID_W + x
const ME_CELL = cell(5, 2)
const MOB_CELL = cell(5, 5)
const PUSH_DEST = cell(7, 5) // where my prediction slid the mob
const OTHER_DEST = cell(6, 5) // where a diverging chain actually stopped it

const ev = (kind, fields) => ({ type: `0x0::fight_events::${kind}`, parsedJson: { fight: FIGHT, ...fields } })

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
  queue: [{ is_mob: false, idx: 0 }],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
}

const boot_with_predicted_push = () => {
  const store = create_fight_store()
  store.getState().input({
    type: 'init',
    fight_id: FIGHT,
    my_key: 'p0',
    ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: GRID_W } },
  })
  store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
  // MY optimistic push: the mob slides to PUSH_DEST (predicted + windowed).
  store.getState().input(
    {
      type: 'predicted',
      basis_version: 6,
      intent_id: 'push1',
      actions: [
        { kind: 'Cast', caster_is_mob: false, caster_idx: 0, target_cell: MOB_CELL, ap_cost: 3 },
        { kind: 'Displaced', target_is_mob: true, target_idx: 0, to_cell: PUSH_DEST },
      ],
      beats: [
        { kind: 'cast', at: 0, duration: 100, payload: {} },
        { kind: 'displacement', at: 100, duration: 200, payload: { target_id: 'mob-0', to: { x: 7, y: 5 } } },
      ],
    },
    1_100
  )
  // present the prediction's slide leg (it played).
  const pred = store.getState().wave.find((t) => t.is_local)
  store.getState().input({ type: 'presented', seq: pred.seq }, 1_200)
  return store
}

const receipt_slide_turns = (store) =>
  store.getState().wave.filter((t) => t.is_local && (t.beats ?? []).some((b) => b.kind === 'displacement'))

const my_push_receipt = (to_cell) => ({
  type: 'receipt',
  version: 7,
  receipt: {
    events: [
      ev('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: MOB_CELL }),
      ev('Displaced', {
        target_is_mob: true,
        target_idx: 0,
        kind: 12,
        from_cell: MOB_CELL,
        to_cell,
        requested: 3,
        blocked: 0,
      }),
      ev('Hit', { victim_is_mob: true, victim_idx: 0, amount: 10, remaining_hp: 20 }),
    ],
  },
})

describe('③b receipt displacement_leg dedupe', () => {
  test('a receipt matching the presented prediction (same target + to_cell) adds NO second slide', () => {
    const store = boot_with_predicted_push()
    store.getState().input(my_push_receipt(PUSH_DEST), 1_300)
    expect(receipt_slide_turns(store).length).toBe(0) // deduped — the prediction already slid the mob here
  })

  test('a receipt that diverges (mob stopped elsewhere) PLAYS the leg as the correction', () => {
    const store = boot_with_predicted_push()
    store.getState().input(my_push_receipt(OTHER_DEST), 1_300)
    expect(receipt_slide_turns(store).length).toBe(1) // chain truth corrects — the leg plays to OTHER_DEST
  })
})
