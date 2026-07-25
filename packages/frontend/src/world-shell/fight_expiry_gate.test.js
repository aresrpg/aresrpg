// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #882 EXPIRY GATE — the ONE predicate behind both the permissionless crank door and the player-facing
// "this fight is not advancing" surface. Pure rows only: the whole point of the gate is that the janitor and
// the HUD can never disagree about whether a turn has outlived its on-chain deadline.

import { describe, expect, test } from 'bun:test'

import { EXPIRY_GRACE_MS, turn_liquidatable, turn_overdue_ms, turn_stalled } from './fight_expiry_gate.js'

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
