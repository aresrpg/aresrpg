// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_spectate_addon } from '../../src/game/core/cameras.ts'

test('the shared asset camera preserves right-drag handedness and its target', () => {
  const pose = { yaw: Math.PI }
  const camera = create_spectate_addon({
    focus: () => [16, 16],
    zoom: () => 8,
    ground_y: () => 34,
    yaw: () => pose.yaw,
    pitch: () => 0.3,
  })
  const anchor = { x: 0, y: 0, z: 0, eye_height: 0, speed: 0, on_ground: true }
  const before = camera.frame(anchor, 0)
  // The shared world decreases yaw on right-drag; the former gallery inverted Z.
  pose.yaw -= 0.4
  const after = camera.frame(anchor, 0)
  expect(before.position[2]).toBeLessThan(before.target[2])
  expect(after.position[0]).toBeGreaterThan(before.position[0])
  expect(after.position[2]).toBeGreaterThan(before.position[2])
  expect(after.target).toEqual([16, 34, 16])
})
