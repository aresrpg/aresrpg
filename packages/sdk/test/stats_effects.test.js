// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, test, expect } from 'bun:test'

import { get_max_health, get_secondary_stats, get_total_stat } from '../src/stats.js'
import { apply_wisdom_xp } from '../src/experience.js'

// Stat effects: wisdom multiplies XP (Wisdom XP Bonus l.970 — kept; the proposed health-regen was DROPPED,
// never implemented). The soul -> max-HP convex curve was deleted 2026-07-10:
// the on-chain Character struct never carried a `soul` field (the frontend decode dropped it), so the
// curve's full-soul fallback always fired and the feature was permanently inert (janitor law).

// A minimal character: experience 0 -> level 1, no equipment slots (all stats default), vitality 0.
// base max HP = BASE_LIFE(30) + level1*5 + vitality0 = 35.
const character = (extra = {}) => ({ experience: 0, vitality: 0, ...extra })

describe('max health (base + level*5 + vitality)', () => {
  test('level 1, zero vitality: the base pool', () => {
    expect(get_max_health(character())).toBe(35)
  })

  test('vitality adds 1:1 to the pool', () => {
    expect(get_max_health(character({ vitality: 65 }))).toBe(100) // 30 + 5 + 65
  })

  test('the fight-authoritative equipment aggregate feeds max health and every effective stat', () => {
    const equipped = character({
      strength: 2,
      equipment_stats: { vitality: 3, strength: -3, action: 1 },
    })
    expect(get_max_health(equipped)).toBe(38)
    expect(get_total_stat(equipped, 'strength')).toBe(0)
    expect(get_total_stat(equipped, 'ap')).toBe(7)
  })

  test('positive-only vitality remains a compatibility fallback before the aggregate backfill', () => {
    expect(get_max_health(character({ gear_vitality: 9 }))).toBe(44)
  })
})

describe('wisdom -> XP bonus (xp * (1 + wisdom/600))', () => {
  test('zero / absent wisdom leaves XP unchanged', () => {
    expect(apply_wisdom_xp(600)).toBe(600)
    expect(apply_wisdom_xp(600, 0)).toBe(600)
  })

  test('600 wisdom doubles XP (the reference-corpus calibration point)', () => {
    expect(apply_wisdom_xp(600, 600)).toBe(1200)
  })

  test('partial wisdom gives a floored proportional bonus', () => {
    expect(apply_wisdom_xp(100, 300)).toBe(150) // floor(100 * 900 / 600)
  })

  test('negative wisdom never reduces XP (clamped to 0)', () => {
    expect(apply_wisdom_xp(100, -50)).toBe(100)
  })
})

describe('critical hit -> equipment-only combat bonus', () => {
  const critical_row = value => get_secondary_stats(value).find(({ key }) => key === 'critical')

  test('agility never invents a critical-hit bonus', () => {
    expect(critical_row(character({ agility: 80 }))).toEqual({
      key: 'critical',
      label: 'Critical hit',
      value: 0,
      unit: 'unit',
    })
  })

  test('equipment Critical is the displayed bonus consumed by combat', () => {
    expect(critical_row(character({ agility: 80, hat: { critical: 7 } }))?.value).toBe(7)
  })
})
