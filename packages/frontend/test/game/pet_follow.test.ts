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

test('the leash is three tiers: walk to 30, decision-tick snap to 40, instant teleport past 40', () => {
  const spawned = step_pet_follow(empty_pet_motion(), { x: 2, z: 3 }, 0.1, () => 0.25)
  // 33 blocks, MID-WALK: the committed destination survives (one decision at a time)
  const walking = step_pet_follow(
    { ...spawned, x: -31, z: 3, target_x: -20, target_z: 3 },
    { x: 2, z: 3 },
    0.1,
    () => 0.25
  )
  expect(walking.target_x).toBe(-20)
  // 33 blocks, idle with the decision due: the catch-up snap lands beside the owner
  const snapped = step_pet_follow({ ...spawned, x: -31, z: 3, check_in: 0 }, { x: 2, z: 3 }, 0.1, () => 0.25)
  expect(Math.hypot(snapped.x - 2, snapped.z - 3)).toBeCloseTo(3)
  expect(snapped).toMatchObject({ target_x: Number.NaN, target_z: Number.NaN, moving: false })
  // 42 blocks: instant teleport, even MID-WALK — the one rule above the walk's commitment
  const teleported = step_pet_follow(
    { ...spawned, x: -40, z: 3, target_x: -20, target_z: 3 },
    { x: 2, z: 3 },
    0.1,
    () => 0.25
  )
  expect(Math.hypot(teleported.x - 2, teleported.z - 3)).toBeCloseTo(3)
  expect(teleported.moving).toBe(false)
})

test('a committed walk always completes inside the teleport radius', () => {
  const random = () => 0.5
  // spawn beside the owner, then let the leash decision commit a walk
  const spawned = step_pet_follow(empty_pet_motion(), { x: 0, z: 0 }, 0.1, random)
  const walking = step_pet_follow({ ...spawned, x: 8, z: 0, check_in: 0 }, { x: 0, z: 0 }, 0.05, random)
  expect(walking.moving).toBe(true)
  // the owner sprints to 35 blocks MID-WALK: the walk continues toward its committed target
  const mid = step_pet_follow(walking, { x: 38, z: 0 }, 0.05, random)
  expect(mid.target_x).toBe(walking.target_x)
  expect(mid.moving).toBe(true)
  // once the walk completes and the next decision tick fires, the catch-up snap lands
  const done = step_pet_follow({ ...mid, x: mid.target_x, z: mid.target_z }, { x: 38, z: 0 }, 0.05, random)
  expect(done.moving).toBe(false)
  const snapped = step_pet_follow({ ...done, check_in: 0 }, { x: 38, z: 0 }, 0.05, random)
  expect(Math.hypot(38 - snapped.x, snapped.z)).toBeLessThan(4)
})
