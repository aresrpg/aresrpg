// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1184 — THE COOP VERDICT BLOCK, headless. The reported breakage is run-level: a joiner who lands on chain but
// never appears in the creator's board, a seat missing from the turn order, a settlement only one client folds.
// No per-turn assertion can see any of those (the turns a dropped seat never gets simply do not appear), so the
// rows are graded here against fixtures of exactly those failures — and against the honest holes, which must
// count as neither a pass nor a failure.

import { describe, expect, test } from 'bun:test'

import {
  assert_joiner_seated,
  assert_member_loot,
  assert_move_proofs,
  assert_placements,
  assert_settlement_seen,
  assert_turn_order,
  summarise,
} from '../../src/bot/index.js'

const ALICE = { name: 'alice', character_id: '0xalice' }
const BOB = { name: 'bob', character_id: '0xbob' }
const SEATS = [ALICE, BOB]

const board = (...ids) => ({ ok: true, fighters: ids.map((id) => ({ id })) })

describe('① the joiner is really in the creator’s fight', () => {
  test('passes when the creator’s placement board seats the joiner', () => {
    const [row] = assert_joiner_seated({ seats: SEATS, creator: 'alice', placement_read: board('0xalice', '0xbob') })
    expect(row.pass).toBe(true)
  })

  test('fails when the join landed on chain and the creator’s view never seated it', () => {
    const [row] = assert_joiner_seated({ seats: SEATS, creator: 'alice', placement_read: board('0xalice', 'mob-0') })
    expect(row.pass).toBe(false)
    expect(row.actual).toContain('absent')
  })

  test('an unreadable creator board is a failure, never a silent skip', () => {
    const rows = assert_joiner_seated({
      seats: SEATS,
      creator: 'alice',
      placement_read: { ok: false, error: 'no read' },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].pass).toBe(false)
  })
})

describe('② both seats commit a placement', () => {
  test('one row per seat, and a seat that never placed is red', () => {
    const rows = assert_placements({
      seats: SEATS,
      placements: [{ seat: 'alice', cell: { x: 3, y: 4 }, ok: true }],
    })
    expect(rows.map((r) => r.pass)).toEqual([true, false])
    expect(rows[1].actual).toBe('never placed')
  })
})

describe('③ the turn order carries both seats every round', () => {
  test('green when every observed round lists every seat', () => {
    const [row] = assert_turn_order({
      seats: SEATS,
      turn_orders: [
        { turn: 1, order: ['0xalice', '0xbob', 'mob-0'] },
        { turn: 2, order: ['0xbob', '0xalice'] },
      ],
    })
    expect(row.pass).toBe(true)
  })

  test('names the round and the seat that fell out of the order', () => {
    const [row] = assert_turn_order({
      seats: SEATS,
      turn_orders: [
        { turn: 1, order: ['0xalice', '0xbob'] },
        { turn: 2, order: ['0xalice'] },
      ],
    })
    expect(row.pass).toBe(false)
    expect(row.actual).toBe('round 2: bob')
  })

  test('a run that observed no turn order proves nothing about it', () => {
    expect(assert_turn_order({ seats: SEATS, turn_orders: [] })[0].pass).toBe(false)
  })
})

describe('⑤ a remote move is visible on the other client', () => {
  test('zero proofs is a FAIL that names why, never a quiet pass', () => {
    const [row] = assert_move_proofs(0)
    expect(row.pass).toBe(false)
    expect(row.actual).toContain('no seat committed a move')
  })

  test('one proof is enough to have swept the fact', () => {
    expect(assert_move_proofs(1)[0].pass).toBe(true)
  })
})

describe('⑥ both folds reach the same settlement', () => {
  const final = (seat, winner) => ({ seat, ok: true, winner })

  test('green when every seat folded the same terminal winner', () => {
    const rows = assert_settlement_seen({ seats: SEATS, finals: [final('alice', 0), final('bob', 0)] })
    expect(rows.every((r) => r.pass)).toBe(true)
  })

  test('a seat that never folded a terminal is red, and the agreement row with it', () => {
    const rows = assert_settlement_seen({ seats: SEATS, finals: [final('alice', 0), final('bob', -1)] })
    expect(rows.map((r) => r.pass)).toEqual([true, false, true])
  })

  test('two clients disagreeing on the winner is a desync row', () => {
    const rows = assert_settlement_seen({ seats: SEATS, finals: [final('alice', 0), final('bob', 1)] })
    expect(rows.at(-1).pass).toBe(false)
    expect(rows.at(-1).actual).toContain('2 distinct winner')
  })
})

describe('⑦ per-member loot, and the honest hole', () => {
  test('with no published rows the check is CONTENT-GATED — not a pass and not a failure', () => {
    const [row] = assert_member_loot(null)
    expect(row.gated).toBe(true)
    expect(row.pass).toBe(false)
    expect(row.actual).toContain('no headless door publishes per-member rewards')
  })

  test('a gated row is excluded from the verdict instead of laundered into it', () => {
    const gated = assert_member_loot(null)
    expect(summarise(gated)).toEqual({ checks: 1, passed: 0, failed: 0, gated: 1, verdict: 'PASS' })
    expect(summarise([...gated, ...assert_move_proofs(0)]).verdict).toBe('FAIL')
  })

  test('published rows are graded normally, one per member', () => {
    const rows = assert_member_loot({
      rows: [
        { seat: 'alice', units: 2 },
        { seat: 'bob', units: 0 },
      ],
    })
    expect(rows.map((r) => r.pass)).toEqual([true, false])
  })
})
