// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { create_character_controller } from '../../../src/game/core/character.ts'
import { create_follow_addon } from '../../../src/game/core/cameras.ts'

const anchor = { x: 0, y: 2, z: 0, eye_height: 1.8, speed: 4, on_ground: true, movement_yaw: -Math.PI / 2 }

test('touch travel turns the camera without turning a held joystick heading', () => {
  const camera = create_follow_addon(() => false)
  camera.set_touch_moving(true)
  for (let i = 0; i < 120; i++) camera.frame(anchor, 1 / 60)
  expect(camera.get_yaw()).toBeCloseTo(-Math.PI / 2, 1)
  expect(camera.get_movement_yaw()).toBe(0)
  camera.set_touch_moving(false)
  expect(camera.get_movement_yaw()).toBe(camera.get_yaw())
})

test('desktop and stopped touch movement do not auto rotate', () => {
  const camera = create_follow_addon(() => false)
  camera.frame(anchor, 1)
  expect(camera.get_yaw()).toBe(0)
  camera.set_touch_moving(true)
  camera.frame({ ...anchor, speed: 0 }, 1)
  expect(camera.get_yaw()).toBe(0)
})

test('manual look takes priority and updates the held movement basis', () => {
  const camera = create_follow_addon(() => false)
  camera.set_touch_moving(true)
  camera.rotate(100, 0)
  for (let i = 0; i < 30; i++) camera.frame(anchor, 1 / 60)
  expect(camera.get_yaw()).toBeCloseTo(-0.25, 4)
  expect(camera.get_movement_yaw()).toBeCloseTo(-0.25, 4)
})

test('automatic follow takes the shortest arc across the yaw seam', () => {
  const camera = create_follow_addon(() => false, { yaw: Math.PI - 0.1 })
  camera.set_touch_moving(true)
  camera.frame({ ...anchor, movement_yaw: -Math.PI + 0.1 }, 1 / 60)
  expect(camera.get_yaw()).toBeGreaterThan(Math.PI - 0.1)
  expect(camera.get_yaw()).toBeLessThan(Math.PI + 0.1)
})

test('a held sideways joystick travels straight as the real controller and camera update together', () => {
  const camera = create_follow_addon(() => false)
  const character = create_character_controller({
    solid_at: (_x, y) => y < 0,
    liquid_at: () => false,
    position: [0, 0, 0],
  })
  camera.set_touch_moving(true)
  for (let frame = 0; frame < 120; frame++) {
    character.set_input({ forward: 0, strafe: 1, yaw: camera.get_movement_yaw() })
    character.tick(1 / 60)
    const transform = character.get_transform()
    camera.frame(
      { ...anchor, speed: transform.speed, movement_yaw: Math.atan2(-transform.velocity[0], -transform.velocity[2]) },
      1 / 60
    )
  }
  const [x, , z] = character.get_transform().position
  expect(x).toBeGreaterThan(5)
  expect(Math.abs(z)).toBeLessThan(0.001)
  expect(camera.get_yaw()).toBeCloseTo(-Math.PI / 2, 1)
  character.dispose()
})

test('touch follow converges consistently at different rendering rates', () => {
  const sample = (hz: number) => {
    const camera = create_follow_addon(() => false)
    camera.set_touch_moving(true)
    for (let i = 0; i < hz * 2; i++) camera.frame(anchor, 1 / hz)
    return camera.get_yaw()
  }
  expect(sample(30)).toBeCloseTo(sample(120), 2)
})
