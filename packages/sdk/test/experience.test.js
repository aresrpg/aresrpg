// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Regression gate for the CHARACTER XP CURVE (src/experience.js). The curve + lookup math MUST stay
// byte-identical to the on-chain SSOT: packages/move/sources/character/character_xp.move (`XP_CURVE` const
// + `level_from_xp`). A prior bug had `levels` holding the retro curve DIVIDED BY 10 (wrong) — this test
// pins known cumulative-xp thresholds straight from character_xp.move so that regression can't recur
// silently.

import { describe, test, expect } from 'bun:test'

import {
  levels,
  experience_to_level,
  level_to_experience,
} from '../src/experience.js'

describe('levels curve (ported verbatim from character_xp.move XP_CURVE)', () => {
  test('pins known thresholds from the on-chain table', () => {
    expect(levels[2]).toBe(110) // level 2
    expect(levels[10]).toBe(19200) // level 10
    expect(levels[50]).toBe(5350000) // level 50
    expect(levels[100]).toBe(95886000) // level 100
    expect(levels[200]).toBe(7407232000) // level 200 (MAX_LEVEL)
  })

  test('has exactly 201 entries (index 0 unused..200)', () => {
    expect(levels.length).toBe(201)
  })
})

describe('experience_to_level (mirrors character_xp::level_from_xp binary search)', () => {
  test('xp <= 0 clamps to level 1', () => {
    expect(experience_to_level(0)).toBe(1)
    expect(experience_to_level(-5)).toBe(1)
  })

  test('huge xp clamps to MAX_LEVEL (200)', () => {
    expect(experience_to_level(7407232000)).toBe(200)
    expect(experience_to_level(99999999999)).toBe(200)
  })

  test('lands exactly on the threshold level for known xp values', () => {
    expect(experience_to_level(110)).toBe(2)
    expect(experience_to_level(19200)).toBe(10)
    expect(experience_to_level(5350000)).toBe(50)
    expect(experience_to_level(95886000)).toBe(100)
  })

  test('floors to the level below when xp is just short of the next threshold', () => {
    expect(experience_to_level(109)).toBe(1)
    expect(experience_to_level(19199)).toBe(9)
    expect(experience_to_level(95885999)).toBe(99)
  })
})

describe('level_to_experience (inverse lookup against the same table)', () => {
  test('round-trips known levels', () => {
    expect(level_to_experience(2)).toBe(110)
    expect(level_to_experience(50)).toBe(5350000)
    expect(level_to_experience(100)).toBe(95886000)
    expect(level_to_experience(200)).toBe(7407232000)
  })
})
