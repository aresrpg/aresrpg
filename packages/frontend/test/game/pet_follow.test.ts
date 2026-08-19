// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { empty_pet_motion, step_pet_follow } from '../../src/game/core/pet_follow.ts'

test('pet follow holds one nearby destination until arrival and stays idle inside five blocks', () => {
  const random = () => 0.25
  const spawned = step_pet_follow(empty_pet_motion(), { x: 2, z: 3 }, 0.1, random)
  const nearby = step_pet_follow({ ...spawned, x: -2, z: 3 }, { x: 2, z: 3 }, 0.1, random)
  const chased = step_pet_follow({ ...spawned, x: -8, z: 3 }, { x: 2, z: 3 }, 0.1, random)
  const held = step_pet_follow(chased, { x: 4, z: 4 }, 0.1, () => 0.75)

  expect(spawned).toMatchObject({ x: 2, z: 3, moving: false })
  expect(nearby).toMatchObject({ x: -2, z: 3, moving: false })
  expect(chased.x).toBeGreaterThan(-8)
  expect(chased.moving).toBeTrue()
  expect(Math.hypot(chased.target_x - 2, chased.target_z - 3)).toBeLessThanOrEqual(5)
  expect(chased.target_x % 1).toBe(0.5)
  expect(chased.target_z % 1).toBe(0.5)
  expect(held.target_x).toBe(chased.target_x)
  expect(held.target_z).toBe(chased.target_z)
})

test('pet follow snaps after travel and does not retain a stale destination', () => {
  const spawned = step_pet_follow(empty_pet_motion(), { x: 2, z: 3 }, 0.1, () => 0.25)
  const snapped = step_pet_follow(
    { ...spawned, x: -40, z: 3, target_x: -20, target_z: 3 },
    { x: 2, z: 3 },
    0.1,
    () => 0.25
  )

  expect(Math.hypot(snapped.x - 2, snapped.z - 3)).toBeCloseTo(3)
  expect(snapped).toMatchObject({ target_x: Number.NaN, target_z: Number.NaN, moving: false })
})
