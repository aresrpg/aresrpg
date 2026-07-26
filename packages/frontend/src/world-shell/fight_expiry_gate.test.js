// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #882 EXPIRY GATE — the ONE predicate behind both the permissionless crank door and the player-facing
// "this fight is not advancing" surface. Pure rows only: the whole point of the gate is that the janitor and
// the HUD can never disagree about whether a turn has outlived its on-chain deadline.

import { describe, expect, test } from 'bun:test'

import {
  EXPIRY_GRACE_MS,
  should_auto_end_turn,
  should_report_stall,
  turn_liquidatable,
  turn_overdue_ms,
  turn_stalled,
} from './fight_expiry_gate.js'

const STATUS_ACTIVE = 1
const STATUS_PLACEMENT = 5
const NOW = 1_770_000_000_000 // a real wall-clock epoch: the deadline arithmetic below is absolute ms

describe('turn_overdue_ms (pure)', () => {
  test('only an ACTIVE turn with a real, lapsed deadline is overdue — and it reports BY HOW MUCH', () => {
    expect(turn_overdue_ms({ status: STATUS_ACTIVE, turn_deadline_ms: NOW - 5_000 }, NOW)).toBe(5_000)
    expect(turn_overdue_ms({ status: STATUS_ACTIVE, turn_deadline_ms: NOW }, NOW)).toBe(0) // the instant it lapses
    expect(turn_overdue_ms({ status: STATUS_ACTIVE, turn_deadline_ms: NOW + 1 }, NOW)).toBeNull() // still inside
    expect(turn_overdue_ms({ status: STATUS_ACTIVE, turn_deadline_ms: 0 }, NOW)).toBeNull() // no deadline stamped
    expect(turn_overdue_ms({ status: STATUS_PLACEMENT, turn_deadline_ms: NOW - 5_000 }, NOW)).toBeNull() // placement
    expect(turn_overdue_ms({ status: 3, turn_deadline_ms: NOW - 5_000 }, NOW)).toBeNull() // WON — terminal
    expect(turn_overdue_ms(null, NOW)).toBeNull()
    expect(turn_overdue_ms(undefined, NOW)).toBeNull()
  })

  test('accepts the decoded wire shapes verbatim (string + bigint deadlines)', () => {
    expect(turn_overdue_ms({ status: STATUS_ACTIVE, turn_deadline_ms: String(NOW - 1_000) }, NOW)).toBe(1_000)
    expect(turn_overdue_ms({ status: '1', turn_deadline_ms: BigInt(NOW - 2_000) }, NOW)).toBe(2_000)
  })
})

describe('the two thresholds', () => {
  test('liquidatable the instant it lapses; STALLED only past the janitors grace', () => {
    const at = (over) => ({ status: STATUS_ACTIVE, turn_deadline_ms: NOW - over })
    expect(turn_liquidatable(at(1), NOW)).toBe(true) // the crank door may fire immediately
    expect(turn_stalled(at(1), NOW)).toBe(false) // …but the player is told nothing yet: a crank is likely in flight
    expect(turn_stalled(at(EXPIRY_GRACE_MS - 1), NOW)).toBe(false)
    expect(turn_stalled(at(EXPIRY_GRACE_MS), NOW)).toBe(true) // nobody cranked it — the fight IS stalled, say so
    expect(turn_stalled(at(6 * 3_600_000), NOW)).toBe(true) // the take-7 zombie: hours past its deadline
    expect(turn_liquidatable({ status: STATUS_ACTIVE, turn_deadline_ms: NOW + 1 }, NOW)).toBe(false)
    expect(turn_stalled(null, NOW)).toBe(false)
  })
})

// ── #921 · THE CLIENT ACTS, IT DOES NOT NARRATE ──────────────────────────────────────────────────────────
// The two banners became two verdicts. Pure rows only, for the same reason as above: the automation and the
// button must read the same truth, or the client will press what the player cannot (or refuse what it should).
describe('should_auto_end_turn (pure)', () => {
  const armed = { turn_phase: 'armed', end_armed: true, busy: false }
  const late = { status: STATUS_ACTIVE, turn_deadline_ms: NOW - 1 }

  test('my own late turn is pressed for me the instant it lapses', () => {
    expect(should_auto_end_turn(late, armed, NOW)).toBe(true)
    expect(should_auto_end_turn({ status: STATUS_ACTIVE, turn_deadline_ms: NOW + 1 }, armed, NOW)).toBe(false)
  })

  test('it can never press what the player could not', () => {
    // not my turn / the button is unmounted or disabled / a commit of ours is already in flight
    expect(should_auto_end_turn(late, { ...armed, turn_phase: 'hidden' }, NOW)).toBe(false)
    expect(should_auto_end_turn(late, { ...armed, turn_phase: 'committing' }, NOW)).toBe(false)
    expect(should_auto_end_turn(late, { ...armed, end_armed: false }, NOW)).toBe(false)
    expect(should_auto_end_turn(late, { ...armed, busy: true }, NOW)).toBe(false)
  })

  // A deadline is the WHOLE input: no stamp, nothing to act on. (The simulator's own gate is not this — its
  // local sim DOES stamp a wall-clock deadline — it is the composition flag at the seam, #921 ④.)
  test('a composition with no chain deadline never arms', () => {
    expect(should_auto_end_turn({ status: STATUS_ACTIVE }, armed, NOW)).toBe(false)
    expect(should_auto_end_turn({ status: STATUS_ACTIVE, turn_deadline_ms: 0 }, armed, NOW)).toBe(false)
    expect(should_auto_end_turn(null, armed, NOW)).toBe(false)
  })
})

describe('should_report_stall (pure)', () => {
  const at = (over) => ({ status: STATUS_ACTIVE, turn_deadline_ms: NOW - over })

  test('it shouts only after both auto-doors have had their whole window', () => {
    expect(should_report_stall(at(1), { busy: false }, NOW)).toBe(false)
    expect(should_report_stall(at(EXPIRY_GRACE_MS - 1), { busy: false }, NOW)).toBe(false)
    expect(should_report_stall(at(EXPIRY_GRACE_MS), { busy: false }, NOW)).toBe(true)
  })

  test('a commit of ours in flight is not a stall — the fight IS advancing', () => {
    expect(should_report_stall(at(6 * 3_600_000), { busy: true }, NOW)).toBe(false)
  })

  test('no chain deadline, nothing to report', () => {
    expect(should_report_stall({ status: STATUS_ACTIVE }, { busy: false }, NOW)).toBe(false)
    expect(should_report_stall(null, { busy: false }, NOW)).toBe(false)
  })
})
