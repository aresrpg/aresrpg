// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { airborne_velocity } from '../../../src/game/core/air_motion.ts'

const LIMIT = 15.75

test('glide steering turns through an arc without braking to strafe sideways', () => {
  const next = airborne_velocity([0, -LIMIT], [1, 0], LIMIT, true, 1 / 60)
  expect(next[0]).toBeGreaterThan(0)
  expect(next[0]).toBeLessThan(0.6)
  expect(next[1]).toBeLessThan(-15)
  expect(Math.hypot(...next)).toBeCloseTo(LIMIT)
  let velocity = next
  for (let frame = 0; frame < 180; frame++) velocity = airborne_velocity(velocity, [1, 0], LIMIT, true, 1 / 60)
  expect(velocity[0]).toBeGreaterThan(15)
  expect(Math.abs(velocity[1])).toBeLessThan(0.05)
})

test('releasing direction coasts but cannot retain a jump impulse above the mounted speed budget', () => {
  expect(airborne_velocity([3, -8], [0, 0], LIMIT, true, 1 / 60)).toEqual([3, -8])
  expect(Math.hypot(...airborne_velocity([0, -20], [0, 0], LIMIT, true, 1 / 60))).toBe(LIMIT)
})

test('ordinary airborne control keeps its existing acceleration and no-input momentum', () => {
  expect(airborne_velocity([0, -10], [1, 0], 10.5, false, 1 / 60)[0]).toBeGreaterThan(0)
  expect(airborne_velocity([3, -8], [0, 0], LIMIT, false, 1 / 60)).toEqual([3, -8])
})
