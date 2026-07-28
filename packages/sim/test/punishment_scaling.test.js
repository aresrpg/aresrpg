// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// K_PUNISHMENT_DAMAGE is declared "damage scaling UP as caster HP drops" (spell_effect.move) and BOTH twins used
// to resolve it as a plain damage line, so the scaling half of the kind existed only in that comment. These are
// the SAME seven points `aresrpg_foundation::spell_formula_tests::t_punishment_base_scales_with_missing_life`
// asserts on chain — one table, two languages, so a drift on either side goes red on both.

import { describe, expect, test } from 'bun:test'

import { punishment_base } from '../src/spell_calculator.js'

const caster = (health, health_max) => ({ health, health_max })

describe('punishment_base — the base scales with the caster MISSING life', () => {
  test('full life is the identity: a healthy caster casts an ordinary damage line', () => {
    expect(punishment_base(100, caster(200, 200))).toBe(100)
  })

  test('half life is x1.5 and death’s door is x2 — linear in the missing fraction, bounded', () => {
    expect(punishment_base(100, caster(100, 200))).toBe(150)
    expect(punishment_base(100, caster(0, 200))).toBe(200)
  })

  test('the scale floors like the chain, it never rounds', () => {
    expect(punishment_base(12, caster(100, 200))).toBe(18)
    expect(punishment_base(7, caster(150, 200))).toBe(8)
  })

  test('degenerate life cannot divide by zero or manufacture a discount', () => {
    expect(punishment_base(50, caster(0, 0))).toBe(50)
    expect(punishment_base(50, caster(999, 200))).toBe(50)
  })
})
