// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { pet_locomotion_of, pet_vertical_offset } from '../../src/game/core/pet_locomotion.ts'

describe('pet locomotion', () => {
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
