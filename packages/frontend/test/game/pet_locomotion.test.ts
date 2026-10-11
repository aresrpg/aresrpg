// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { pet_animation, pet_locomotion_of, pet_vertical_offset } from '../../src/game/core/pet_locomotion.ts'

describe('pet locomotion', () => {
  test('local and remote pet animation uses a quiet flight pose and preserves ordinary swim and gait', () => {
    expect(pet_animation('walk', true, 'FALL', true)).toBe('IDLE')
    expect(pet_animation('walk', true, 'FALL', false)).toBe('FALL')
    expect(pet_animation('walk', true, undefined, false)).toBe('RUN')
    expect(pet_animation('walk', false, undefined, false)).toBe('IDLE')
    expect(pet_animation('swim', true, undefined, false)).toBe('SWIM')
  })
  test('uses authored families instead of guessing from item names', () => {
    expect(pet_locomotion_of({ pet_movement: 'swim' })).toBe('swim')
    expect(pet_locomotion_of({ pet_movement: 'fly' })).toBe('fly')
    expect(pet_locomotion_of({ pet_movement: 'walk' })).toBe('walk')
    expect(pet_locomotion_of({})).toBe('walk')
  })

  test('never mirrors the owner jump: walkers stay grounded, swim/fly hover on their own clock', () => {
    expect(pet_vertical_offset('walk', 0)).toBe(0)
    expect(pet_vertical_offset('fly', 0)).toBe(1.5)
    expect(pet_vertical_offset('swim', 0)).toBe(1.5)
    expect(pet_vertical_offset('swim', 0.65)).toBeCloseTo(1.65)
  })
})
