// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { MIDDAY_TIME_OF_DAY } from '@aresrpg/engine'
import { expect, test } from 'bun:test'

import { camera_mode_after, time_of_day_for_camera_mode } from '../../../src/game/core/cameras.ts'

// REPORTED 2026-08-21: refresh into a live fight and the board is drawn, the player walks
// around freely, and their overworld avatar stands on the board beside their own fighter. One
// cause — pointing the world at a character is async (IndexedDB), so the handover lands after
// the board mounted and takes the camera off it. Follow mode also puts the avatar back in the
// scene, which is the double.
test('a mounted board keeps the camera when a late character handover lands', () => {
  expect(camera_mode_after('fight', { mode: 'follow', from: 'character' })).toBe('fight')
  expect(camera_mode_after('fight', { mode: 'spectate', from: 'character' })).toBe('fight')
})

test('the board hands its own camera back, and outside a fight nothing is held', () => {
  expect(camera_mode_after('fight', { mode: 'follow', from: 'board' })).toBe('follow')
  expect(camera_mode_after('follow', { mode: 'fight', from: 'board' })).toBe('fight')
  expect(camera_mode_after('follow', { mode: 'spectate', from: 'character' })).toBe('spectate')
  expect(camera_mode_after('spectate', { mode: 'follow', from: 'character' })).toBe('follow')
})

test('fight presentation pins noon without changing the live world clock outside combat', () => {
  expect(MIDDAY_TIME_OF_DAY).toBe(3 / 8)
  expect(time_of_day_for_camera_mode('fight', 0.9)).toBe(MIDDAY_TIME_OF_DAY)
  expect(time_of_day_for_camera_mode('follow', 0.9)).toBe(0.9)
  expect(time_of_day_for_camera_mode('spectate', 0.9)).toBe(0.9)
})

test('an authored opening pitch preserves the normal follow view for other callers', async () => {
  const { create_follow_addon } = await import('../../../src/game/core/cameras.ts')
  const anchor = { x: 0, y: 72, z: 0, eye_height: 1.8, speed: 0, on_ground: true }
  const normal = create_follow_addon(() => false).frame(anchor, 1 / 60)
  const opening = create_follow_addon(() => false, { yaw: Math.PI, pitch: 0.22 }).frame(anchor, 1 / 60)
  expect(
    Math.atan2(
      normal.target[1] - normal.position[1],
      Math.hypot(normal.target[0] - normal.position[0], normal.target[2] - normal.position[2])
    )
  ).toBeCloseTo(-Math.PI / 18)
  expect(
    Math.atan2(
      opening.target[1] - opening.position[1],
      Math.hypot(opening.target[0] - opening.position[0], opening.target[2] - opening.position[2])
    )
  ).toBeCloseTo(0.22)
})
