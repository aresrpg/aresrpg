// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { advance_pet_flight_tilt } from '../src/pet_flight_tilt.ts'

test('turning banks into the curve, descent pitches down, and stopping the glide levels out', () => {
  const initial = advance_pet_flight_tilt(undefined, [0, 10, 0], 0, true, 0.05)
  let pose = advance_pet_flight_tilt(initial, [0.03, 9.9, 0.5], 0.1, true, 0.05)
  expect(pose.bank).toBeLessThan(0)
  expect(pose.pitch).toBeGreaterThan(0)
  for (let frame = 0; frame < 60; frame++) pose = advance_pet_flight_tilt(pose, pose.position, pose.yaw, false, 1 / 60)
  expect(Math.abs(pose.bank)).toBeLessThan(0.001)
  expect(Math.abs(pose.pitch)).toBeLessThan(0.001)
})

test('crossing the yaw seam does not produce a full-turn bank spike', () => {
  const initial = advance_pet_flight_tilt(undefined, [0, 10, 0], Math.PI - 0.001, true, 0.05)
  const next = advance_pet_flight_tilt(initial, [0, 10, -0.5], -Math.PI + 0.001, true, 0.05)
  expect(Math.abs(next.bank)).toBeLessThan(0.01)
})
