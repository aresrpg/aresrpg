// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import {
  pose_matches_character,
  publish_pose,
  publish_observed_pose,
  read_pose,
  read_displayed_pose,
  subscribe_pose,
  type WorldPose,
} from '../../../src/game/core/pose_feed.ts'

const pose = (character_id: string): WorldPose =>
  Object.freeze({ character_id, x: 1, y: 2, z: 3, yaw: 0, riding: false, gliding: false, time_of_day: 0.5 })

test('a delayed pose can never cross a character selection boundary', () => {
  const previous_pose = pose('0xprevious')
  expect(pose_matches_character(previous_pose, '0xprevious')).toBeTrue()
  expect(pose_matches_character(previous_pose, '0xnext')).toBeFalse()
  expect(pose_matches_character(null, '0xnext')).toBeFalse()
})

test('observed camera telemetry cannot publish movement and returns to the owned pose after stopping', () => {
  publish_pose(null)
  publish_observed_pose(null)
  let controls = 0
  const stop = subscribe_pose(() => {
    controls += 1
  })
  try {
    publish_observed_pose(pose('agent'))
    expect(read_displayed_pose()?.character_id).toBe('agent')
    expect(read_pose()).toBeNull()
    expect(controls).toBe(0)
    publish_observed_pose(null)
    publish_pose(pose('human'))
    expect(read_displayed_pose()?.character_id).toBe('human')
    expect(read_pose()?.character_id).toBe('human')
    expect(controls).toBe(1)
  } finally {
    stop()
    publish_observed_pose(null)
    publish_pose(null)
  }
})
