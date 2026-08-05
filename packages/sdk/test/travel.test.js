// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// TWIN PARITY — every assertion below is the JS replay of an assertion in the chain's own oracle,
// `packages/move/foundation/tests/world_math_tests.move` (t_travel_ok_within_beyond_and_pet_boosted_budget).
// The Move source is the law; this file is the proof the client twin computes the SAME verdicts, so a
// chain-side retune of the budget constants reds here instead of silently splitting the two rules.
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'bun:test'

import { travel_budget_blocks, travel_ok } from '../src/travel.js'

// The twin has no import edge to the chain, so the drift guard READS the Move law's own constants and pins
// the JS behaviour that must follow from them. A retune on either side reds here before it can split the two.
const world_math = readFileSync(new URL('../../move/foundation/sources/world_math.move', import.meta.url), 'utf8')
const move_const = (name) => {
  const found = new RegExp(`const ${name}: u64 = ([0-9_]+);`).exec(world_math)
  if (!found) throw new Error(`world_math.move no longer declares ${name} — the twin's anchor is gone`)
  return Number(found[1].replaceAll('_', ''))
}

describe('the Move law the twin mirrors', () => {
  it('still carries the constants this port was written against', () => {
    expect(move_const('SPEED_SCALE')).toBe(100_000)
    expect(move_const('MAX_LINEAR')).toBe(4_000_000)
    expect(move_const('BIG_MS')).toBe(10_000_000_000_000)
    expect(move_const('PET_NUM')).toBe(3)
    expect(move_const('PET_DEN')).toBe(2)
  })

  it('derives the same budget the chain would, straight off those constants', () => {
    const speed_budget = 1150
    const elapsed_ms = 60_000
    expect(travel_budget_blocks(speed_budget, elapsed_ms)).toBe(
      Math.floor((speed_budget * elapsed_ms) / move_const('SPEED_SCALE'))
    )
    // a pathological elapsed saturates at MAX_LINEAR instead of overflowing, exactly as budget_blocks does
    expect(travel_budget_blocks(speed_budget, move_const('BIG_MS'))).toBe(move_const('MAX_LINEAR'))
    // the mount grant is ÷PET_DEN then ×PET_NUM — never a float multiply
    expect(travel_budget_blocks(1000, 2_100, true)).toBe(
      Math.floor(Math.floor((1000 * 2_100) / move_const('SPEED_SCALE')) / move_const('PET_DEN')) * move_const('PET_NUM')
    )
  })
})

describe('travel_ok — parity with world_math.move', () => {
  // move/foundation/tests/world_math_tests.move:17 — dx=15 <= budget 20 -> reachable
  it('accepts a move inside the budget', () => {
    expect(travel_ok(1000, 0, 0, 0, 15, 0, 2000, false)).toBe(true)
  })

  // :18 — dx=25 > budget 20 -> not yet
  it('refuses a move beyond the budget', () => {
    expect(travel_ok(1000, 0, 0, 0, 25, 0, 2000, false)).toBe(false)
  })

  // :19 — pet_both: 20/2*3=30 >= 25 -> reachable
  it('grants the ×1.5 mount budget when a pet is equipped at both ends', () => {
    expect(travel_ok(1000, 0, 0, 0, 25, 0, 2000, true)).toBe(true)
  })

  // :20 — now_ms < from_ms -> always false (the chain aborts this as ECheckpointFuture)
  it('refuses a clock regression', () => {
    expect(travel_ok(1000, 0, 0, 5000, 0, 0, 4000, false)).toBe(false)
  })

  // :22 — a pathological elapsed saturates the budget instead of overflowing
  it('short-circuits a budget that dwarfs any in-world distance', () => {
    expect(travel_ok(1, 0, 0, 0, 4_000_000, 4_000_000, 20_000_000_000_000, false)).toBe(true)
  })

  it('measures EUCLIDEAN distance on both axes, not per-axis', () => {
    // budget 20 blocks; (12,16) is exactly 20 away — legal — while (15,15) is ~21.2 — not yet.
    expect(travel_ok(1000, 0, 0, 0, 12, 16, 2000, false)).toBe(true)
    expect(travel_ok(1000, 0, 0, 0, 15, 15, 2000, false)).toBe(false)
  })

  it('is space-agnostic: a shared per-axis offset never changes the verdict', () => {
    // the same move expressed in signed world blocks and in unsigned chain blocks (offset 250_000)
    expect(travel_ok(1150, -600, 40, 1_000, -100, 40, 61_000)).toBe(true)
    expect(travel_ok(1150, 249_400, 250_040, 1_000, 249_900, 250_040, 61_000)).toBe(true)
  })
})

describe('travel_budget_blocks — the coverable distance', () => {
  it('is speed × elapsed in the chain fixed point (blocks/sec ×100, ms)', () => {
    expect(travel_budget_blocks(1150, 60_000)).toBe(690) // 11.5 blocks/s for 60s
    expect(travel_budget_blocks(1150, 0)).toBe(0)
  })

  it('truncates like the chain u64 division rather than rounding', () => {
    expect(travel_budget_blocks(1150, 999)).toBe(11) // 11.4885 -> 11
  })

  it('applies the mount multiplier as ÷2 then ×3, exactly as the chain does', () => {
    expect(travel_budget_blocks(1000, 2_000, true)).toBe(30) // (20/2)*3 — never 20*1.5 on an odd budget
    expect(travel_budget_blocks(1000, 2_100, true)).toBe(30) // 21/2=10 -> 30
  })
})
