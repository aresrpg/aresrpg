// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import {
  amplify_damage,
  apply_centered_resistance,
  crit_denominator,
  ln_e6,
  push_collision_damage,
  remove_points,
} from '../src/fight_math.ts'

import { MOVE_MATH_FIXTURE } from './fixtures/move_math.ts'

describe('pinned Move math classes', () => {
  test('damage amplification then centered resistance', () => {
    const row = MOVE_MATH_FIXTURE.damage
    const amplified = amplify_damage(row.base, row.primary, row.raw_damage)
    expect(apply_centered_resistance(amplified, row.centered_resistance, row.center)).toBe(row.expected)
  })

  test('live-point wisdom dodge', () => {
    const row = MOVE_MATH_FIXTURE.dodge
    const result = remove_points({
      rng: row.rng,
      value: row.value,
      dodge: true,
      caster_wisdom: row.caster_wisdom,
      target_wisdom: row.target_wisdom,
      current: row.current,
      maximum: row.maximum,
    })
    expect(result).toEqual({ state: row.expected_state, removed: row.expected_removed })
  })

  test('blocked push collision', () => {
    const row = MOVE_MATH_FIXTURE.push
    expect(push_collision_damage(row.caster_level, row.blocked_cells)).toBe(row.expected)
  })

  // The crit seam: `crit_denominator` divides by the integer `ln_e6`, so a silent edit to the
  // fixed-point log loop desyncs client crit prediction from chain truth everywhere it is read.
  test('fixed-point natural log', () => {
    for (const row of MOVE_MATH_FIXTURE.ln_e6) expect(ln_e6(row.x)).toBe(row.expected)
  })

  test('crit quotation denominator', () => {
    for (const row of MOVE_MATH_FIXTURE.crit_denominator)
      expect(crit_denominator(row.crit_1_in, row.cri, row.agility)).toBe(row.expected)
  })
})
