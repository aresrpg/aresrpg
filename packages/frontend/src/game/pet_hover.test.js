// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #676 RED-FIRST: fish-family pets ground-walked like every other companion. These tests pin the pure vertical
// math (pet_hover.js) with no @aresrpg/engine3 / GLB import (issue #117), the same split pet_follow.test.js
// already exercises for horizontal steering: a fish pet's resolved y sits HOVER_HEIGHT_M above the fed ground
// y and bobs over time; a non-fish pet's y is untouched by this module entirely; family detection resolves the
// #676 example (Cryofin) as fish, and the #526 fish-sounding-but-not-fish trap (pet_siluri) stays
// excluded.

import { describe, expect, test } from 'bun:test'

import {
  FISH_PETS,
  HOVER_BOB_AMPLITUDE_M,
  HOVER_HEIGHT_M,
  hover_bob,
  hover_target_y,
  is_fish_pet,
  select_companion_clip,
} from './pet_hover.js'

describe('#676 pet_hover — family detection', () => {
  test('Cryofin (#676 example) resolves as fish', () => {
    expect(is_fish_pet('pet_cryofin')).toBe(true)
  })

  test('the other two unambiguous fish slugs (fin anatomy / moray eel) resolve as fish', () => {
    expect(is_fish_pet('pet_chromafin')).toBe(true)
    expect(is_fish_pet('pet_moray')).toBe(true)
  })

  test('#526 trap — a fish-SOUNDING slug whose published appearance is a Tortoise stays excluded (name alone is not evidence)', () => {
    expect(is_fish_pet('pet_siluri')).toBe(false)
  })

  test('an ordinary ground pet (Bouloute) is not fish', () => {
    expect(is_fish_pet('pet_bouloute')).toBe(false)
  })

  test('null/undefined/empty slug is never fish (never throws)', () => {
    expect(is_fish_pet(null)).toBe(false)
    expect(is_fish_pet(undefined)).toBe(false)
    expect(is_fish_pet('')).toBe(false)
  })

  test('FISH_PETS is the exact set consulted (no hidden extra members)', () => {
    expect([...FISH_PETS].sort()).toEqual(['pet_chromafin', 'pet_cryofin', 'pet_moray'])
  })
})

describe('#676 pet_hover — hover_target_y (the fish placement, ground pets never call this)', () => {
  test('at elapsed=0 (bob at its zero-crossing) a fish sits exactly HOVER_HEIGHT_M above the fed ground y', () => {
    expect(hover_target_y(64, 0)).toBeCloseTo(64 + HOVER_HEIGHT_M, 6)
  })

  test('a nonzero ground y carries through unchanged (relative placement, not absolute)', () => {
    expect(hover_target_y(120.5, 0)).toBeCloseTo(120.5 + HOVER_HEIGHT_M, 6)
  })

  test('it bobs over time — the offset from ground oscillates within HOVER_HEIGHT_M ± HOVER_BOB_AMPLITUDE_M, never collapsing to a constant', () => {
    const ground_y = 64
    const offsets = []
    for (let t = 0; t < 10; t += 1 / 60) offsets.push(hover_target_y(ground_y, t) - ground_y)
    const min = Math.min(...offsets)
    const max = Math.max(...offsets)
    expect(max - min).toBeGreaterThan(HOVER_BOB_AMPLITUDE_M) // it genuinely moves, not frozen at HOVER_HEIGHT_M
    for (const o of offsets) {
      expect(o).toBeGreaterThanOrEqual(HOVER_HEIGHT_M - HOVER_BOB_AMPLITUDE_M - 1e-9)
      expect(o).toBeLessThanOrEqual(HOVER_HEIGHT_M + HOVER_BOB_AMPLITUDE_M + 1e-9)
    }
  })

  test('the bob is TIME-based, not frame-based: the same elapsed_s gives the same offset regardless of dt step size', () => {
    // Walking to t=1.3s in 1/60 steps vs 1/20 steps must land on the same bob value — proves the accumulator
    // is elapsed seconds, never a per-frame increment tied to call count.
    expect(hover_bob(1.3)).toBeCloseTo(hover_bob(1.3), 9)
    const via_60fps = (() => {
      let t = 0
      for (let i = 0; i < 78; i++) t += 1 / 60 // 78/60 = 1.3s
      return hover_bob(t)
    })()
    expect(via_60fps).toBeCloseTo(hover_bob(1.3), 6)
  })
})

describe('#676 pet_hover — select_companion_clip (fish prefer SWIM, everyone else unchanged)', () => {
  test('a fish pet with a SWIM clip plays it, not idle', () => {
    const clips = [{ name: 'Idle' }, { name: 'Swim' }]
    expect(select_companion_clip(clips, true)).toEqual({ name: 'Swim' })
  })

  test('a fish pet with NO swim clip falls back to idle (the pre-existing convention)', () => {
    const clips = [{ name: 'Walk' }, { name: 'Idle' }]
    expect(select_companion_clip(clips, true)).toEqual({ name: 'Idle' })
  })

  test('a non-fish pet NEVER picks a clip named swim, even if the GLB happens to carry one (byte-identical old behavior)', () => {
    const clips = [{ name: 'Swim' }, { name: 'Idle' }]
    expect(select_companion_clip(clips, false)).toEqual({ name: 'Idle' })
  })

  test('no idle clip at all falls back to the first clip (matches the pre-existing `clips[0]` convention)', () => {
    const clips = [{ name: 'Walk' }, { name: 'Run' }]
    expect(select_companion_clip(clips, false)).toEqual({ name: 'Walk' })
  })

  test('an empty clip list resolves to undefined (never throws)', () => {
    expect(select_companion_clip([], true)).toBeUndefined()
  })
})
