// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { pose_matches_character, type WorldPose } from '../../../src/game/core/pose_feed.ts'

const pose = (character_id: string): WorldPose =>
  Object.freeze({ character_id, x: 1, y: 2, z: 3, yaw: 0, riding: false, time_of_day: 0.5 })

test('a delayed pose can never cross a character selection boundary', () => {
  const previous_pose = pose('0xprevious')
  expect(pose_matches_character(previous_pose, '0xprevious')).toBeTrue()
  expect(pose_matches_character(previous_pose, '0xnext')).toBeFalse()
  expect(pose_matches_character(null, '0xnext')).toBeFalse()
})
