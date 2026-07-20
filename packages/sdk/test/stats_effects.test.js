import { describe, test, expect } from 'bun:test'

import { get_max_health } from '../src/stats.js'
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
