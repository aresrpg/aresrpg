// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, test, expect } from 'bun:test'

import { new_stats, stat_strength } from '../src/spell.js'
import { alter_stat, STAT_STRENGTH } from '../src/spell_effect.js'
import {
  new_fighter,
  refresh_stats,
  alter_base_stat,
  stats,
} from '../src/stats_derive.js'

// PARITY FIXTURES — the timed-alter recompute cases copied VERBATIM from pure_tests.move
// ("Timed-alter recompute (the revert-saturation regression)"). STAT_STRENGTH from spell_effect is stat id 0.

// Move helper `seat_with_strength(base)` + `strength_of(p)`.
const seat_with_strength = base =>
  new_fighter(new_stats(base, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0))
const strength_of = f => stat_strength(stats(f))

describe('stats refresh — parity with pure_tests.move', () => {
  test('timed_debuff_exceeding_stat_reverts_exactly: 30, −50 → 0; row leaves → exactly 30', () => {
    const p = seat_with_strength(30)
    const debuff = alter_stat(STAT_STRENGTH, 50, true, true, 2)
    refresh_stats(p, [debuff])
    expect(strength_of(p)).toBe(0)
    refresh_stats(p, []) // row expired/dispelled → re-derive from base
    expect(strength_of(p)).toBe(30)
  })

  test('interleaved_clamped_alters_rederive_exactly: 30 +50 −70 → 10; buff expires → 0; debuff expires → 30', () => {
    const p = seat_with_strength(30)
    const buff = alter_stat(STAT_STRENGTH, 50, false, true, 2)
    const debuff = alter_stat(STAT_STRENGTH, 70, true, true, 3)
    refresh_stats(p, [buff, debuff])
    expect(strength_of(p)).toBe(10)
    refresh_stats(p, [debuff]) // buff expired first
    expect(strength_of(p)).toBe(0)
    refresh_stats(p, []) // debuff expired
    expect(strength_of(p)).toBe(30)
  })

  test('permanent_alter_lands_on_base: +10 permanent survives; −100 timed → 0; row leaves → 40', () => {
    const p = seat_with_strength(30)
    alter_base_stat(p, STAT_STRENGTH, 10, false)
    refresh_stats(p, [])
    expect(strength_of(p)).toBe(40)
    const debuff = alter_stat(STAT_STRENGTH, 100, true, true, 1)
    refresh_stats(p, [debuff])
    expect(strength_of(p)).toBe(0)
    refresh_stats(p, [])
    expect(strength_of(p)).toBe(40)
  })
})
