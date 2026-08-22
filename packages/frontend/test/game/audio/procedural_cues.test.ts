// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { PROCEDURAL_CUE_TONES } from '../../../src/game/audio/procedural_cues.ts'

test('every semantic reward owns a bounded audible envelope', () => {
  expect(Object.keys(PROCEDURAL_CUE_TONES)).toEqual(['discovery', 'gather', 'level_up', 'victory', 'defeat'])
  Object.values(PROCEDURAL_CUE_TONES).forEach((tones) => {
    expect(tones.length).toBeGreaterThan(0)
    tones.forEach(({ duration, gain }) => {
      expect(duration).toBeLessThanOrEqual(0.3)
      expect(gain).toBeLessThanOrEqual(0.14)
    })
  })
})
