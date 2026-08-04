// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2219 — FOLD KEY → ENTITY ID HAS ONE HOME AND ONE ANSWER, INCLUDING FOR THE SEAT IT CANNOT NAME.
//
// THE DEFECT: the mapping grew a second home. `fold.js` `fold_key_entity_id` was added — with a comment claiming
// "one home, so the wave producer and the divergence corrector (#2151) can never disagree about WHO was hit" —
// beside `project_views.js` `entity_id_of_key`, which already owned it. They disagreed on exactly the row that
// matters: a seat the roster cannot name. The projection answered null (its consumers DROP such a seat rather
// than guess); the fold answered the synthetic `player-<idx>`, an id no entity in the client carries. So the
// #2151 corrector addressed its correction to a fighter that does not exist and the rewrite silently never
// landed — the one fix that home was built to guarantee.
//
// THE LAW SEALED HERE: one resolver (participant_identity.js), one unresolvable-seat answer — null. The corrector
// already branches on it (`if (!target_id) return rest`), so null makes the skip EXPLICIT where the synthetic made
// it silent, and every projection consumer keeps the null its own fallback chain is written against.

import { describe, expect, test } from 'bun:test'

import { result_fold_read } from '../src/bot/read.js'
import { entity_id_of_fold_key } from '../src/participant_identity.js'
import { create_fight_store } from '../src/store.js'

const FIGHT = '0xf2219'
const CHAR = '0xcaster'
const W = 20
const enc = (x, y) => y * W + x
const ME = enc(5, 5)
const THEM = enc(6, 5)

// ONE seated participant (seat 0). Seat 1 is the seat the roster cannot name — the row the whole issue is about.
const FIGHT_OBJECT = {
  id: FIGHT,
  status: 1,
  width: W,
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
      cell: ME,
    },
  ],
  mobs: [],
  queue: [{ is_mob: false, idx: 0 }],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
  turn_entropy: 90_000,
  turn_ordinal: 1,
}

const boot = () => {
  const store = create_fight_store()
  store
    .getState()
    .input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: W } } })
  store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
  return store
}

/** My optimistic cast on the UNNAMEABLE seat 1 — predicted to leave it at 40. */
const predict = (store) =>
  store.getState().input(
    {
      type: 'predicted',
      basis_version: 6,
      intent_id: 'cast:2219:1',
      actions: [
        { kind: 'Cast', caster_is_mob: false, caster_idx: 0, target_cell: THEM, ap_cost: 3, damaging: true },
        { kind: 'Hit', victim_is_mob: false, victim_idx: 1, remaining_hp: 40 },
      ],
      beats: [{ kind: 'cast', at: 0, duration: 100, payload: {} }],
    },
    1_100
  )

/** The chain's own amount for that cast — a genuine divergence (38, not the predicted 40). */
const receipt = (store) =>
  store.getState().input(
    {
      type: 'receipt',
      version: 6,
      events: [
        {
          type: `0x0::fight_events::Hit`,
          parsedJson: { fight: FIGHT, victim_is_mob: false, victim_idx: 1, amount: '12', remaining_hp: '38' },
        },
        {
          type: `0x0::fight_events::Cast`,
          parsedJson: { fight: FIGHT, caster_is_mob: false, caster_idx: 0, target_cell: THEM },
        },
      ],
    },
    2_000
  )

describe('#2219 — one resolver, one answer for the seat the roster cannot name', () => {
  test('the corrector does not address a correction to an id no entity carries', () => {
    const store = boot()
    predict(store)
    receipt(store)
    const { divergence } = store.getState()
    expect(divergence?.action, 'sanity: the claim diverged at all').toBe('Hit:p1')
    // RED at HEAD: fold_key_entity_id answered the synthetic `player-1`, so the divergence shipped
    // `correction: { target_id: 'player-1', kind: 'damage', amount: 12 }` — an address the combat log can never
    // match, spent as a silent no-op instead of the skip the corrector already had an arm for.
    expect(divergence.correction ?? null, 'an unnameable victim carries NO correction — an explicit skip').toBe(null)
  })

  test('the projection consumer drops that same seat — the answer both halves now share', () => {
    // The positive control, green at HEAD and after: `result_fold_read` names seats through the projection home,
    // which has always answered null here ("a seat the roster cannot name is dropped, never guessed"). At HEAD
    // this passing while the corrector above fails IS the divergence: same key, two answers.
    const read = result_fold_read({
      board: { fighters: { p0: { hp: 50, alive: true, cell: ME }, p1: { hp: 38, alive: true, cell: THEM } } },
      escrow: FIGHT_OBJECT.participants,
      my_key: 'p0',
    })
    expect(
      read.fighters.map((f) => f.id),
      'the unnameable seat is dropped, never guessed'
    ).toEqual([CHAR])
  })

  test('the one home answers both halves of the key space, and null for what it cannot name', () => {
    const escrow = FIGHT_OBJECT.participants
    expect(entity_id_of_fold_key(escrow, 'p0'), 'a named seat is its character').toBe(CHAR)
    expect(entity_id_of_fold_key([{ owner: '0xbbb', addr: '0xbbb' }], 'p0'), 'an addr-keyed seat still resolves').toBe(
      '0xbbb'
    )
    expect(entity_id_of_fold_key(escrow, 'm2'), 'the mob half is the same vocabulary').toBe('mob-2')
    expect(entity_id_of_fold_key(escrow, 'p1'), 'the seat the roster cannot name').toBeNull()
    expect(entity_id_of_fold_key(escrow, null), 'no key, no answer').toBeNull()
    expect(entity_id_of_fold_key(escrow, 'x0'), 'a key outside the fold key space').toBeNull()
  })
})
