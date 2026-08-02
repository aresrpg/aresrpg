// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2044 — THE ORACLE STOPS LYING WHEN IT CANNOT LOOK.
//
// A killing blow that takes the LAST living enemy ends the fight, so `fight_view()` is null and the seam's
// post-commit read carries no roster at all. Three rows of that action then coerced the hole into a plausible
// number (`?? 0` reads as "dead", `undefined` is falsy so "dead") and one coerced it into `NaN` (a comparison
// that can never pass). The sheet printed 3 passes and 1 fail on an action NOTHING had measured.
//
// RED-first, and the red is the whole point: an instrument that cannot see must REFUSE, never default. These
// rows drive the four laws the fix installs —
//   1. a missing post-commit read is ONE explicit gap row per action, never three coercions and a NaN;
//   2. a fight-ending cast is graded off the RESULT FOLD the client still holds, not the roster that is gone;
//   3. a divergence row names the CLOCK and the ROLL both sides drew on, not only the two outputs;
//   4. a cast the pre-turn bank could not predict is a counted GAP, and a saturated (0 hp) prediction is a
//      TRIVIAL row excluded from the parity count — counting it turned 0-for-2 into a reported 2-of-4.

import { describe, expect, test } from 'bun:test'

import {
  assert_prediction_proofs,
  assert_turn,
  prediction_tally,
  result_fold_read,
  summarise,
} from '../../src/bot/index.js'
import { encode } from '../../src/los.js'

const ME = '0xme'
const MOB = 'mob-0'

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

/** What `dev_read()` returns once the killing blow ended the fight and the client holds NOTHING else. */
const terminal_read = { ok: false, error: 'no active fight' }

/** The committed fold the seam ships beside that refusal — the fold's own `p<seat>`/`m<idx>` keys, raw. */
const fold = (mob_hp) => ({
  board: {
    winner: 0,
    turn_ordinal: 7,
    fighters: {
      p0: { key: 'p0', is_mob: false, cell: encode(2, 2), hp: 100, alive: true, statuses: [] },
      m0: { key: 'm0', is_mob: true, cell: encode(4, 2), hp: mob_hp, alive: mob_hp > 0, statuses: [] },
    },
  },
  escrow: [{ character: ME }],
  my_key: 'p0',
})

/** The same refusal, with the RESULT FOLD the client still holds beside it (the seam's `result_fold` arm). */
const terminal_with_result = { ok: false, error: 'no active fight', result_fold: fold(0) }

const plan = {
  actions: [
    {
      kind: 1,
      cell: { x: 4, y: 2 },
      spell_id: '0xwar',
      spell_key: 'warcleave',
      ap_cost: 5,
      from: { x: 2, y: 2 },
      expect: { type: 'damage', target_id: MOB, min_damage: 1, kill: true, from: { x: 2, y: 2 } },
    },
  ],
}

const bank = (remaining_hp, over = {}) => ({
  index: 0,
  spell_id: '0xwar',
  spell_key: 'warcleave',
  spell_level: 1,
  target_cell: { x: 4, y: 2 },
  caster_build: { stats: { strength: 40 }, level: 12 },
  hp: remaining_hp == null ? [] : [{ id: MOB, remaining_hp }],
  unresolved: [],
  ...over,
})

const action_rows = (rows) => rows.filter((row) => row.kind !== 'turn')
const parity_rows = (rows) => rows.filter((row) => String(row.note).startsWith('PREDICTION↔AUTHORITY'))

describe('#2044 ① a missing post-commit read is a refused verdict, never a default', () => {
  test('RED: a fight-ending kill with NO readable result yields ONE explicit gap row — not 3 passes and a NaN', () => {
    const rows = assert_turn(plan, { ok: true, before: read(4), after: terminal_read, predicted: [bank(0)] })
    const graded = action_rows(rows)
    expect(graded).toHaveLength(1)
    expect(graded[0].pass).toBe(false)
    expect(graded[0].actual).toBe('no active fight')
    expect(String(graded[0].note)).toContain('NO POST-COMMIT READ')
    // the exact two lies the old sheet told
    expect(rows.some((row) => row.pass && row.check.includes('the target lost HP'))).toBe(false)
    expect(rows.some((row) => String(row.actual).includes('NaN'))).toBe(false)
    expect(summarise(rows).verdict).toBe('FAIL')
  })

  test('a target absent from a readable post-commit roster is the SAME gap — an absent row is not a corpse', () => {
    const orphan = { ok: true, my_id: ME, fighters: [fighter(ME, 100)] }
    const rows = action_rows(assert_turn(plan, { ok: true, before: read(4), after: orphan, predicted: [bank(0)] }))
    expect(rows).toHaveLength(1)
    expect(rows[0].pass).toBe(false)
    expect(String(rows[0].note)).toContain('NO POST-COMMIT READ')
  })

  test('CONTROL: a readable roster still grades every row exactly as before', () => {
    const rows = assert_turn(plan, { ok: true, before: read(4), after: read(0), predicted: [bank(0)] })
    expect(rows.every((row) => row.pass)).toBe(true)
    expect(rows.some((row) => row.check.includes('a lethal cast kills the target'))).toBe(true)
  })
})

describe('#2044 ② the killing blow is graded off the RESULT FOLD', () => {
  test('RED: the terminal result fold grades damage, the kill AND the prediction the roster could not', () => {
    const rows = assert_turn(plan, { ok: true, before: read(4), after: terminal_with_result, predicted: [bank(0)] })
    const graded = action_rows(rows)
    expect(graded.map((row) => row.check)).toEqual([
      'the target lost HP',
      'a lethal cast kills the target',
      `the authority resolved the HP the client predicted for ${MOB}`,
    ])
    expect(graded.every((row) => row.pass)).toBe(true)
    // every one of them says where it looked — a row graded off the result fold never poses as a roster read
    expect(graded.every((row) => String(row.note).includes('RESULT FOLD'))).toBe(true)
    expect(rows.some((row) => String(row.actual).includes('NaN'))).toBe(false)
  })

  test('the result fold still FAILS a kill it does not show — the oracle is not a rubber stamp', () => {
    const survived = { ...terminal_with_result, result_fold: fold(3) }
    const rows = action_rows(assert_turn(plan, { ok: true, before: read(4), after: survived, predicted: [bank(0)] }))
    expect(rows.find((row) => row.check.includes('a lethal cast kills')).pass).toBe(false)
    expect(rows.find((row) => row.check.includes('the client predicted')).pass).toBe(false)
  })

  test('result_fold_read projects the committed fold to the read shape, keyed by ENTITY id', () => {
    const raw = fold(0)
    const board = {
      ...raw.board,
      fighters: {
        ...raw.board.fighters,
        m0: { ...raw.board.fighters.m0, statuses: [{ kind: 9, remaining_turns: 2 }] },
      },
    }
    const projected = result_fold_read({ ...raw, board })
    expect(projected.ok).toBe(true)
    expect(projected.terminal).toBe(true)
    expect(projected.my_id).toBe(ME)
    expect(projected.winner).toBe(0)
    expect(projected.fighters).toEqual([
      { id: ME, hp_committed: 100, alive_committed: true, cell_committed: { x: 2, y: 2 }, effects: [] },
      {
        id: MOB,
        hp_committed: 0,
        alive_committed: false,
        cell_committed: { x: 4, y: 2 },
        effects: [{ kind: 9, remaining_turns: 2, value: null, stat: null, element: null }],
      },
    ])
  })

  test('a fold with no fighters is NOT a result — an empty projection would be the same lie in a new coat', () => {
    expect(result_fold_read({ board: { fighters: {} }, escrow: [], my_key: 'p0' })).toBe(null)
    expect(result_fold_read({ board: null })).toBe(null)
    // a seat the roster cannot NAME is dropped, never guessed — a fold with only that seat is no result at all
    expect(result_fold_read({ board: { fighters: { p0: { hp: 5, alive: true } } }, escrow: [] })).toBe(null)
  })
})

describe('#2044 ③ a divergence row names the INPUTS, not only the outputs', () => {
  test('RED: the banked clock and resolved roll ride the divergence row', () => {
    const clocked = bank(18, {
      clock: { turn_ordinal: '7', turn_entropy: '4242', seat: 0, slot: 2 },
      damage_roll: 5931,
    })
    const [divergence] = parity_rows(
      assert_turn(plan, { ok: true, before: read(60), after: read(21), predicted: [clocked] })
    )
    expect(divergence.pass).toBe(false)
    for (const fragment of ['turn_ordinal 7', 'turn_entropy 4242', 'seat 0', 'slot 2', 'roll 5931'])
      expect(String(divergence.note)).toContain(fragment)
  })

  test('a bank with no clock says so — an unnamed roll is a gap, never a blank', () => {
    const [divergence] = parity_rows(
      assert_turn(plan, { ok: true, before: read(60), after: read(21), predicted: [bank(18)] })
    )
    expect(String(divergence.note)).toContain('no clock banked')
  })
})

describe('#2044 ④ unpredictable casts are counted gaps; saturated predictions are trivial', () => {
  test('RED: a cast the pre-turn bank could not predict is a GAP row, never silence', () => {
    const refused = bank(null, { unresolved: ['cast_rejected:SIM_CAST_REJECTED', 'post_move_legality'] })
    const rows = action_rows(assert_turn(plan, { ok: true, before: read(60), after: read(53), predicted: [refused] }))
    const gap = rows.find((row) => row.check.includes('the client predicted this cast'))
    expect(gap).toBeDefined()
    expect(gap.pass).toBe(false)
    expect(String(gap.actual)).toContain('post_move_legality')
  })

  test('a non-damage cast that claims no HP stays silent — only a REASON makes a gap row', () => {
    const rows = action_rows(
      assert_turn(plan, { ok: true, before: read(60), after: read(53), predicted: [bank(null)] })
    )
    expect(rows.some((row) => row.check.includes('the client predicted this cast'))).toBe(false)
  })

  test('RED: a prediction of 0 hp is TRIVIAL — it rides the sheet and leaves the parity count alone', () => {
    const result = { ok: true, before: read(4), after: read(0), predicted: [bank(0)] }
    const [parity] = parity_rows(assert_turn(plan, result))
    expect(parity.pass).toBe(true)
    expect(parity.trivial).toBe(true)
    expect(String(parity.note)).toContain('TRIVIAL')
    const tally = prediction_tally(plan, result)
    expect(tally.checked).toBe(0)
    expect(tally.trivial).toBe(1)
    // and the run refuses to call a sheet of trivial rows a proven parity sweep — it names the reason
    const [proof] = assert_prediction_proofs(tally)
    expect(proof.pass).toBe(false)
    expect(String(proof.actual)).toContain('trivial')
  })

  test('a non-saturated prediction is still a real comparison and still counts', () => {
    const result = { ok: true, before: read(60), after: read(18), predicted: [bank(18)] }
    const [parity] = parity_rows(assert_turn(plan, result))
    expect(parity.pass).toBe(true)
    expect(parity.trivial).toBeUndefined()
    expect(prediction_tally(plan, result)).toEqual({ checked: 1, trivial: 0, unresolved: [] })
  })
})
