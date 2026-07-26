// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1100 (coop) — THE CROSS-CLIENT PROOF, headless. Two browsers hold two independent folds of one chain fight,
// and each of them is individually self-consistent: a status applied on one page and missing on the other is a
// desync that NO per-page assertion can see. These fixtures are those two folds, so the check that catches the
// desync is proven by an expectation here and the coop run is left to prove only the wiring.

import { describe, expect, test } from 'bun:test'

import { assert_cross_client, assert_status_proof_ran, summarise } from '../../src/bot/index.js'

const A = '0xseat_a'
const B = '0xseat_b'

const fighter = (id, over = {}) => ({
  id,
  team: 0,
  name: id,
  cell: { x: 4, y: 4 },
  cell_committed: { x: 4, y: 4 },
  hp: 100,
  hp_committed: 100,
  hp_max: 100,
  ap: 6,
  ap_committed: 6,
  mp: 3,
  mp_committed: 3,
  dead: false,
  alive_committed: true,
  effects: [],
  ...over,
})

const read = (my_id, fighters) => ({ ok: true, my_id, turn_number: 3, winner: -1, fighters })

/** A committed status cast by seat A on seat B — the shape the policy hands the assertions. */
const buff_plan = (target_id, kinds = [7]) => ({
  actions: [
    {
      kind: 1,
      cell: { x: 6, y: 4 },
      spell_id: '0xbuff',
      spell_key: 'battle_trance',
      ap_cost: 3,
      expect: { type: 'status', target_id, kinds },
    },
  ],
})

describe('cross-client fold agreement', () => {
  test('both clients folding the same turn passes every row', () => {
    const after = read(A, [fighter(A), fighter('mob-0', { team: 1, hp_committed: 60, cell_committed: { x: 8, y: 4 } })])
    const observer = read(B, [
      fighter(A),
      fighter(B, { cell_committed: { x: 3, y: 4 } }),
      fighter('mob-0', { team: 1, hp_committed: 60, cell_committed: { x: 8, y: 4 } }),
    ])
    const plan = { actions: [{ kind: 1, cell: { x: 8, y: 4 }, expect: { type: 'damage', target_id: 'mob-0' } }] }
    const { rows } = assert_cross_client(plan, { ok: true, after }, observer)
    expect(summarise(rows).verdict).toBe('PASS')
    // the actor AND the action's target — both are facts the other page must already hold.
    expect(rows.length).toBe(2)
  })

  test('an observer whose HP disagrees is a FAIL, not a warning', () => {
    const after = read(A, [fighter(A), fighter('mob-0', { team: 1, hp_committed: 60 })])
    // the damage never reached this page: it still shows the pre-turn HP, and is perfectly self-consistent.
    const observer = read(B, [fighter(A), fighter('mob-0', { team: 1, hp_committed: 100 })])
    const plan = { actions: [{ kind: 1, cell: { x: 8, y: 4 }, expect: { type: 'damage', target_id: 'mob-0' } }] }
    const { rows } = assert_cross_client(plan, { ok: true, after }, observer)
    expect(rows.some((r) => !r.pass && r.check.includes('mob-0'))).toBe(true)
  })

  test('a fighter the observer has never heard of is a FAIL', () => {
    const after = read(A, [fighter(A), fighter('mob-0', { team: 1 })])
    const observer = read(B, [fighter(B)])
    const { rows } = assert_cross_client({ actions: [] }, { ok: true, after }, observer)
    expect(rows.every((r) => !r.pass)).toBe(true)
    expect(rows[0].actual).toContain('absent')
  })

  test('a walk one client folded and the other did not is caught by the cell row', () => {
    const after = read(A, [fighter(A, { cell_committed: { x: 9, y: 2 } })])
    const observer = read(B, [fighter(A, { cell_committed: { x: 4, y: 4 } }), fighter(B)])
    const plan = { actions: [{ kind: 0, cell: { x: 9, y: 2 }, expect: { type: 'move', mp_cost: 3 } }] }
    const { rows } = assert_cross_client(plan, { ok: true, after }, observer)
    expect(summarise(rows).failed).toBe(1)
  })
})

describe('cross-client status visibility — the coop ruling’s own proof', () => {
  test('a buff seat A cast on seat B is visible from seat B’s page', () => {
    const after = read(A, [fighter(A), fighter(B, { effects: [{ kind: 7, remaining_turns: 3 }] })])
    const observer = read(B, [fighter(A), fighter(B, { effects: [{ kind: 7, remaining_turns: 3 }] })])
    const { rows, status_proofs } = assert_cross_client(buff_plan(B), { ok: true, after }, observer)
    expect(status_proofs).toBe(1)
    expect(summarise(rows).verdict).toBe('PASS')
  })

  test('a buff that landed on the caster’s page and NOT on the observer’s is the desync it FAILs on', () => {
    const after = read(A, [fighter(A), fighter(B, { effects: [{ kind: 7, remaining_turns: 3 }] })])
    const observer = read(B, [fighter(A), fighter(B)]) // no status row here — the exact cross-client bug
    const { rows, status_proofs } = assert_cross_client(buff_plan(B), { ok: true, after }, observer)
    expect(status_proofs).toBe(1)
    expect(rows.some((r) => !r.pass && r.check.includes('visible from the other client'))).toBe(true)
  })

  test('one status kind of two missing still fails — the row is per KIND', () => {
    const rider = [{ kind: 7 }, { kind: 9 }]
    const after = read(A, [fighter(A), fighter(B, { effects: rider })])
    const observer = read(B, [fighter(A), fighter(B, { effects: [{ kind: 7 }] })])
    const { rows, status_proofs } = assert_cross_client(buff_plan(B, [7, 9]), { ok: true, after }, observer)
    expect(status_proofs).toBe(2)
    expect(summarise(rows).failed).toBe(1)
  })
})

describe('the honest edges', () => {
  test('a REFUSED turn produces no cross-client rows — assert_turn already owns that failure', () => {
    const { rows } = assert_cross_client(buff_plan(B), { ok: false, error: 'not my turn' }, read(B, [fighter(B)]))
    expect(rows).toEqual([])
  })

  test('an observer that cannot read the fight is ONE explicit FAIL, never silence', () => {
    const after = read(A, [fighter(A)])
    const { rows } = assert_cross_client(buff_plan(B), { ok: true, after }, { ok: false, error: 'no active fight' })
    expect(rows.length).toBe(1)
    expect(rows[0].pass).toBe(false)
    expect(rows[0].actual).toBe('no active fight')
  })

  test('a coop run with zero status proofs FAILs and carries the reason', () => {
    const [row] = assert_status_proof_ran(0, 'the seats’ books hold no buff at their level')
    expect(row.pass).toBe(false)
    expect(row.actual).toContain('the seats’ books hold no buff at their level')
  })

  test('a coop run that landed one status proof passes the run row', () => {
    expect(assert_status_proof_ran(1, 'unused').every((r) => r.pass)).toBe(true)
  })
})
