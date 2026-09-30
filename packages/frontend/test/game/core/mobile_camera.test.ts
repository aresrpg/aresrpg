// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { create_follow_addon } from '../../../src/game/core/cameras.ts'

const anchor = { x: 0, y: 2, z: 0, eye_height: 1.8, speed: 4, on_ground: true }

test('moving the character never rotates the camera automatically', () => {
  const camera = create_follow_addon(() => false, { yaw: 0.7 })
  for (let frame = 0; frame < 120; frame++) camera.frame({ ...anchor, x: frame / 10 }, 1 / 60)
  expect(camera.get_yaw()).toBe(0.7)
})

test('manual look remains at the chosen angle while the character keeps moving', () => {
  const camera = create_follow_addon(() => false)
  camera.rotate(200, 0)
  for (let frame = 0; frame < 180; frame++) camera.frame({ ...anchor, z: -frame / 10 }, 1 / 60)
  expect(camera.get_yaw()).toBeCloseTo(-0.5, 8)
})
