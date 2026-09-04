// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { master_volume_from, scale_audio_volume, set_master_audio_volume } from '../../../src/game/core/audio_volume.ts'

test('master volume defaults legacy settings and clamps invalid bounds', () => {
  expect(master_volume_from(undefined)).toBe(1)
  expect(master_volume_from(Number.NaN)).toBe(1)
  expect(master_volume_from(-1)).toBe(0)
  expect(master_volume_from(2)).toBe(1)
})

test('every non-reactive audio path scales through the current master volume', () => {
  set_master_audio_volume(0.25)
  expect(scale_audio_volume(0.8)).toBeCloseTo(0.2)
  set_master_audio_volume(0)
  expect(scale_audio_volume(0.8)).toBe(0)
  set_master_audio_volume(1)
})
