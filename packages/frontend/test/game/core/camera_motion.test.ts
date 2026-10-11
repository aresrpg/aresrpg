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

test('small idle movements stay inside the dead zone, while larger movements follow smoothly', () => {
  const camera = create_follow_addon(() => false)
  const initial = camera.frame(anchor, 1 / 60)
  const jitter = { ...anchor, x: 0.06, y: 2.08, z: -2.94 }
  const still = Array.from({ length: 120 }, () => camera.frame(jitter, 1 / 60)).at(-1)!
  expect(still.position).toEqual(initial.position)
  const moved = camera.frame({ ...anchor, x: 1 }, 1 / 60)
  expect(moved.position[0]).toBeGreaterThan(initial.position[0])
  expect(moved.position[0]).toBeLessThan(initial.position[0] + 0.3)
})

test('lookahead leads travel, eases on reversal, and leaves mouse yaw unchanged', () => {
  const camera = create_follow_addon(() => false)
  const baseline = camera.frame(anchor, 1 / 60)
  const moving = { ...anchor, speed: 10, velocity: [10, 0, 0] as const }
  const ahead = Array.from({ length: 120 }, () => camera.frame(moving, 1 / 60)).at(-1)!
  expect(ahead.position[0] - baseline.position[0]).toBeCloseTo(1.4, 2)
  const reverse = camera.frame({ ...moving, velocity: [-10, 0, 0] }, 1 / 60)
  expect(reverse.position[0]).toBeGreaterThan(baseline.position[0] + 1)
  expect(yaw_of(reverse)).toBeCloseTo(yaw_of(baseline), 8)
  const stopped = Array.from({ length: 180 }, () => camera.frame(anchor, 1 / 60)).at(-1)!
  expect(stopped.position[0]).toBeCloseTo(baseline.position[0], 5)
})

test('first person follows the actual eye within the dead zone and ignores lookahead', () => {
  const camera = create_follow_addon(() => false)
  camera.dolly(-20)
  Array.from({ length: 120 }, () => camera.frame(anchor, 1 / 60))
  const moved = camera.frame({ ...anchor, x: 0.05, velocity: [10, 0, 0] }, 1 / 60)
  expect(moved.position).toEqual([0.05, 3.8, -3])
})

test('mounted FOV eases with speed and returns to baseline after stopping or dismounting', () => {
  const camera = create_follow_addon(() => false)
  camera.frame(anchor, 1 / 60)
  const riding = { ...anchor, riding: true, speed: 16 }
  const first = camera.frame(riding, 1 / 60)
  expect(first.fov).toBeGreaterThan(68)
  expect(first.fov).toBeLessThan(70)
  expect(first.speed_wind!).toBeGreaterThan(0)
  expect(first.speed_wind!).toBeLessThan(0.1)
  const fast = Array.from({ length: 120 }, () => camera.frame(riding, 1 / 60)).at(-1)!
  expect(fast.fov).toBeCloseTo(78, 2)
  expect(fast.speed_wind).toBeCloseTo(1, 2)
  expect(camera.get_bob_offset()).toBe(0)
  const dismounted = Array.from({ length: 120 }, () => camera.frame({ ...riding, riding: false }, 1 / 60)).at(-1)!
  expect(dismounted.fov).toBeCloseTo(72, 2)
  expect(dismounted.speed_wind!).toBeLessThan(0.001)
  const idle = Array.from({ length: 120 }, () => camera.frame({ ...anchor, riding: true }, 1 / 60)).at(-1)!
  expect(idle.fov).toBeCloseTo(68, 2)
  expect(idle.speed_wind!).toBeLessThan(0.001)
})
