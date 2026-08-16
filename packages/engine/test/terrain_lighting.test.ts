// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { ao_brightness, face_brightness } from '../src/terrain_lighting.ts'

describe('voxel lighting contract', () => {
  test('keeps the proven directional face contrast', () => {
    expect(Array.from({ length: 6 }, (_, face) => face_brightness(face))).toEqual([0.6, 0.6, 1, 0.5, 0.8, 0.8])
  })

  test('keeps contact shade readable and open corners unchanged', () => {
    expect(ao_brightness(0, true)).toBeCloseTo(0.6425)
    expect(ao_brightness(0, false)).toBeCloseTo(0.727)
    expect(ao_brightness(3, true)).toBe(1)
  })
})
