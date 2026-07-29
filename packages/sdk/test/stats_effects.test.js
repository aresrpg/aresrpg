// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, test, expect } from 'bun:test'

import { get_max_health, get_secondary_stats, get_total_stat } from '../src/stats.js'

// Stat effects: the soul -> max-HP convex curve was deleted 2026-07-10:
// the on-chain Character struct never carried a `soul` field (the frontend decode dropped it), so the
// curve's full-soul fallback always fired and the feature was permanently inert (janitor law).

// A minimal Senshi: experience 0 -> level 1, no equipment slots (all stats default), vitality 0.
// base max HP = the class base (70) + 0 levels gained + vitality 0 = 70. The FORMULA's own parity with the
// chain lives in max_hp_parity.test.js (#867); this block only pins how the stat inputs reach it.
const character = (extra = {}) => ({ classe: 'senshi', experience: 0, vitality: 0, ...extra })

describe('max health (class base + 5 per level gained + vitality)', () => {
  test('level 1, zero vitality: the class base pool', () => {
    expect(get_max_health(character())).toBe(70)
  })

  test('vitality adds 1:1 to the pool', () => {
    expect(get_max_health(character({ vitality: 65 }))).toBe(135) // 70 + 0 + 65
  })

  test('the class base is per-class, never a flat constant', () => {
    expect(get_max_health(character({ classe: 'yogen' }))).toBe(30)
    expect(get_max_health(character({ classe: 'ikari' }))).toBe(120)
  })

  test('the fight-authoritative equipment aggregate feeds max health and every effective stat', () => {
    const equipped = character({
      strength: 2,
      equipment_stats: { vitality: 3, strength: -3, action: 1 },
    })
    expect(get_max_health(equipped)).toBe(73)
    expect(get_total_stat(equipped, 'strength')).toBe(0)
    expect(get_total_stat(equipped, 'ap')).toBe(7)
  })

  test('positive-only vitality remains a compatibility fallback before the aggregate backfill', () => {
    expect(get_max_health(character({ gear_vitality: 9 }))).toBe(79)
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
