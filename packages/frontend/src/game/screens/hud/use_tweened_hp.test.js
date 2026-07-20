// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// HP TWEEN pure core (life updates were too fast on the hud and the nameplate). rAF drives the
// hook; the STEP math is pure + deterministic and proven here. RED at HEAD: hp_tween_step does not exist.

import { describe, expect, test } from 'bun:test'

import { hp_tween_step, HP_TWEEN_MS } from './use_tweened_hp.js'

describe('hp_tween_step — the eased HP count core', () => {
  test('elapsed 0 holds the FROM value (never snaps to target on frame 0)', () => {
    expect(hp_tween_step(100, 60, 0)).toBe(100)
  })

  test('elapsed >= duration lands exactly on the target', () => {
    expect(hp_tween_step(100, 60, HP_TWEEN_MS)).toBe(60)
    expect(hp_tween_step(100, 60, HP_TWEEN_MS * 2)).toBe(60)
  })

  test('mid-tween sits strictly between the bounds and eases DOWN toward the target', () => {
    const mid = hp_tween_step(100, 60, HP_TWEEN_MS / 2)
    expect(mid).toBeLessThan(100)
    expect(mid).toBeGreaterThan(60)
  })

  test('counts UP too (a heal), monotonic across the tween', () => {
    const a = hp_tween_step(40, 90, HP_TWEEN_MS * 0.25)
    const b = hp_tween_step(40, 90, HP_TWEEN_MS * 0.75)
    expect(a).toBeGreaterThanOrEqual(40)
    expect(b).toBeGreaterThan(a)
    expect(b).toBeLessThanOrEqual(90)
  })

  test('a non-finite prior display snaps to the target (never counts from junk)', () => {
    expect(hp_tween_step(Number.NaN, 75, 0)).toBe(75)
    expect(hp_tween_step(undefined, 75, 0)).toBe(75)
  })

  test('integer output throughout (HP is a whole number)', () => {
    expect(Number.isInteger(hp_tween_step(100, 61, HP_TWEEN_MS / 3))).toBe(true)
  })
})
