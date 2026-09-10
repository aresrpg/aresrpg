// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { CELESTIAL_CYCLE_MS, MIDDAY_TIME_OF_DAY } from '@aresrpg/engine'

import { world_daylight } from '../../../src/game/core/daylight.ts'

test('disabled cycling stays at midday across time and overrides a debug night pin', () => {
  for (const time of [0, CELESTIAL_CYCLE_MS / 2, CELESTIAL_CYCLE_MS * 4]) {
    expect(world_daylight(time, null, false)).toBe(MIDDAY_TIME_OF_DAY)
    expect(world_daylight(time, 0.9, false)).toBe(MIDDAY_TIME_OF_DAY)
  }
})

test('enabling resumes the current clock or the explicit preview pin', () => {
  expect(world_daylight(0, null, true)).toBe(0.31)
  expect(world_daylight(CELESTIAL_CYCLE_MS / 2, null, true)).toBe(0.81)
  expect(world_daylight(CELESTIAL_CYCLE_MS, 0.9, true)).toBe(0.9)
})
