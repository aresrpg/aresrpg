// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { camera_mode_after, FIGHT_TIME_OF_DAY, time_of_day_for_camera_mode } from '../../../src/game/core/cameras.ts'

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
  expect(FIGHT_TIME_OF_DAY).toBe(3 / 8)
  expect(time_of_day_for_camera_mode('fight', 0.9)).toBe(FIGHT_TIME_OF_DAY)
  expect(time_of_day_for_camera_mode('follow', 0.9)).toBe(0.9)
  expect(time_of_day_for_camera_mode('spectate', 0.9)).toBe(0.9)
})
