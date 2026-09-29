// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { create_follow_addon, type CameraFrame } from '../../../src/game/core/cameras.ts'

const anchor = { x: 0, y: 2, z: -3, eye_height: 1.8, speed: 0, on_ground: true }
const yaw_of = ({ position, target }: CameraFrame) => Math.atan2(position[0] - target[0], position[2] - target[2])

test('a batched mouse delta eases into the rendered view instead of snapping in one frame', () => {
  const camera = create_follow_addon(() => false)
  camera.frame(anchor, 1 / 60)
  camera.rotate(80, 0)
  const first = yaw_of(camera.frame(anchor, 1 / 60))
  expect(Math.abs(first)).toBeGreaterThan(0.03)
  expect(Math.abs(first)).toBeLessThan(0.12)
  const settled = Array.from({ length: 20 }, () => camera.frame(anchor, 1 / 60)).at(-1)!
  expect(yaw_of(settled)).toBeCloseTo(-0.2, 3)
})

test('mouse smoothing has the same settling rate at 60 and 120 Hz', () => {
  const sample = (hz: number) => {
    const camera = create_follow_addon(() => false)
    camera.frame(anchor, 1 / hz)
    camera.rotate(160, 0)
    return yaw_of(Array.from({ length: hz / 10 }, () => camera.frame(anchor, 1 / hz)).at(-1)!)
  }
  expect(sample(60)).toBeCloseTo(sample(120), 8)
})

test('moving toward a wall does not make the camera jump in quarter-block increments', () => {
  const samples = Array.from({ length: 30 }, (_, index) => {
    const camera = create_follow_addon((_x, _y, z) => z >= 0)
    const pose = { ...anchor, z: -3.1 + index * 0.01 }
    return Array.from({ length: 90 }, () => camera.frame(pose, 1 / 60)).at(-1)!.position[2]
  })
  expect(Math.max(...samples)).toBeLessThan(-0.299)
  expect(Math.max(...samples) - Math.min(...samples)).toBeLessThan(0.012)
})
