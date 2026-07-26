// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1144 — THE BANKED-PREDICTION ORACLE, headless. The bot's every other assertion reads `hp_committed` on BOTH
// sides of an action, so it compares chain truth against chain truth: it can prove a cast did something and can
// never prove it did what the player was shown. The owner's live report — a cast that forecast 2 HP of damage
// and killed the mob outright — passes every one of those rows.
//
// So the seam banks the client's own `predict_cast` output BEFORE staging the turn, and this drives the assert
// over that bank: a divergent number is a FAIL row naming BOTH values, the spell rank and the build it was
// predicted with. RED-first, on purpose — the first test here doctors a banked prediction and requires the row
// to fail, because an oracle that has never been seen to fail is the disease it was built to cure.

import { describe, expect, test } from 'bun:test'

import { assert_prediction_proofs, assert_turn, prediction_tally, summarise } from '../../src/bot/index.js'

const ME = '0xme'
const MOB = 'mob-0'

/** A fighter row in the seam's read shape (only the fields the assertions read). */
const fighter = (id, hp, over = {}) => ({
  id,
  team: id === ME ? 0 : 1,
  name: id,
  cell: { x: 2, y: 2 },
  cell_committed: { x: 2, y: 2 },
  hp,
  hp_committed: hp,
  hp_max: 100,
  ap: 6,
  ap_committed: 6,
  mp: 3,
  mp_committed: 3,
  alive_committed: hp > 0,
  effects: [],
  ...over,
})

const read = (mob_hp) => ({ ok: true, my_id: ME, fighters: [fighter(ME, 100), fighter(MOB, mob_hp)] })

/** One damage cast on the mob — the plan shape `plan_turn` emits. */
const plan = {
  actions: [
    {
      kind: 1,
      cell: { x: 4, y: 2 },
      spell_id: '0xcinder',
      spell_key: 'cinder_shaft',
      ap_cost: 4,
      from: { x: 2, y: 2 },
      expect: { type: 'damage', target_id: MOB, min_damage: 1, kill: false, from: { x: 2, y: 2 } },
    },
  ],
}

/** A bank row in the seam's `predicted` shape. `remaining_hp` is what the client told the player. */
const bank = (remaining_hp, over = {}) => ({
  index: 0,
  spell_id: '0xcinder',
  spell_key: 'cinder_shaft',
  spell_level: 6,
  target_cell: { x: 4, y: 2 },
  caster_build: { stats: { intelligence: 100, raw_damage: 5 }, level: 200 },
  hp: remaining_hp == null ? [] : [{ id: MOB, remaining_hp }],
  unresolved: [],
  ...over,
})

const commit = ({ before_hp, after_hp, predicted }) => ({
  ok: true,
  before: read(before_hp),
  after: read(after_hp),
  ...(predicted === undefined ? {} : { predicted }),
})

const parity_rows = (rows) => rows.filter((row) => String(row.note).startsWith('PREDICTION↔AUTHORITY'))

describe('#1144 — the bot compares its PREDICTION against the chain, not the chain against itself', () => {
  test('RED: a doctored prediction diverging from the committed fold is a FAIL row naming both values', () => {
    // The owner's own case: the client forecast 2 HP left, the authority resolved a corpse.
    const rows = assert_turn(plan, commit({ before_hp: 60, after_hp: 0, predicted: [bank(2)] }))
    const parity = parity_rows(rows)
    expect(parity).toHaveLength(1)
    expect(parity[0].pass).toBe(false)
    expect(parity[0].expected).toBe('2 hp (cinder_shaft rank 6)')
    expect(parity[0].actual).toBe('0 hp (committed fold)')
    // the FAIL row carries the seat build the prediction ran on — a divergence must be reproducible, not an anecdote
    expect(parity[0].note).toContain('intelligence')
    expect(summarise(rows).verdict).toBe('FAIL')
  })

  test('the old committed-vs-committed rows stay GREEN on that same divergence — why the oracle had to exist', () => {
    const rows = assert_turn(plan, commit({ before_hp: 60, after_hp: 0, predicted: [] }))
    expect(rows.every((row) => row.pass)).toBe(true)
    expect(parity_rows(rows)).toHaveLength(0)
  })

  test('GREEN: a prediction the chain reproduces exactly passes, and only when it is exact', () => {
    const agreed = parity_rows(assert_turn(plan, commit({ before_hp: 60, after_hp: 18, predicted: [bank(18)] })))
    expect(agreed).toHaveLength(1)
    expect(agreed[0].pass).toBe(true)
    // one HP either side is a divergence — this is an equality oracle, never a threshold
    const off_by_one = parity_rows(assert_turn(plan, commit({ before_hp: 60, after_hp: 18, predicted: [bank(19)] })))
    expect(off_by_one[0].pass).toBe(false)
  })

  test('a cast that claimed no HP for its target grades nothing — the delta row owns that fact', () => {
    const result = commit({ before_hp: 60, after_hp: 18, predicted: [bank(null)] })
    expect(parity_rows(assert_turn(plan, result))).toHaveLength(0)
    expect(prediction_tally(plan, result).checked).toBe(0)
  })

  // MEASURED on the oracle's first live drive (sim, turn 6): the seat lost 5 HP no prediction claimed, and it was
  // a mob hitting back — a committed turn closes with `act_pass` and the authority resolves the opponents' turn
  // INSIDE the same commit. So the seat's own HP is not gradable against a pre-turn prediction, and a row that
  // graded it would make this gate lie in the other direction.
  test('the SEAT ITSELF is never graded — the opponents’ reply lands inside the same commit window', () => {
    const self_plan = {
      actions: [
        {
          ...plan.actions[0],
          expect: { type: 'status', target_id: ME, kinds: [9], from: { x: 2, y: 2 } },
        },
      ],
    }
    const self_bank = [bank(95, { hp: [{ id: ME, remaining_hp: 95 }] })]
    const result = {
      ok: true,
      before: { ok: true, my_id: ME, fighters: [fighter(ME, 100), fighter(MOB, 60)] },
      after: { ok: true, my_id: ME, fighters: [fighter(ME, 88), fighter(MOB, 60)] },
      predicted: self_bank,
    }
    expect(parity_rows(assert_turn(self_plan, result))).toHaveLength(0)
    expect(prediction_tally(self_plan, result).checked).toBe(0)
  })

  test('an UNRESOLVED prediction is a counted gap, never a fabricated row', () => {
    const result = commit({ before_hp: 60, after_hp: 18, predicted: [bank(null, { unresolved: ['chance'] })] })
    expect(parity_rows(assert_turn(plan, result))).toHaveLength(0)
    const tally = prediction_tally(plan, result)
    expect(tally).toEqual({ checked: 0, unresolved: ['chance'] })
    // and the run says so out loud instead of reporting a quiet PASS
    const [proof] = assert_prediction_proofs(tally)
    expect(proof.pass).toBe(false)
    expect(String(proof.actual)).toContain('chance')
  })

  test('a run that never compared a prediction to the chain FAILS at run level', () => {
    const [silent] = assert_prediction_proofs({ checked: 0, unresolved: [] })
    expect(silent.pass).toBe(false)
    expect(String(silent.actual)).toContain('banked no predictions')
    const [proven] = assert_prediction_proofs(
      prediction_tally(plan, commit({ before_hp: 60, after_hp: 18, predicted: [bank(18)] }))
    )
    expect(proven.pass).toBe(true)
    expect(proven.actual).toBe('1')
  })

  test('only the PLANNED target is asserted — collateral predictions ride the sheet unasserted', () => {
    // A prediction that also touches the caster (life steal) must not be compared against a fold that later
    // actions have moved: the pre-turn bank never claimed that state.
    const collateral = bank(18, {
      hp: [
        { id: MOB, remaining_hp: 18 },
        { id: ME, remaining_hp: 999 },
      ],
    })
    const rows = parity_rows(assert_turn(plan, commit({ before_hp: 60, after_hp: 18, predicted: [collateral] })))
    expect(rows).toHaveLength(1)
    expect(rows[0].pass).toBe(true)
  })
})
