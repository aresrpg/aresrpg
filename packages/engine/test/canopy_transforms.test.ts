// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import {
  CANOPY_JITTER,
  CANOPY_LOD,
  CANOPY_YAW_OFFSET,
  CANOPY_YAW_STEP,
  canopy_rotation,
  canopy_variant,
} from '../src/canopy_transforms.ts'
import { CANOPY_BOUNDS_MARGIN } from '../src/opaque_canopy.ts'

test('neighbouring clumps cannot share an axis-aligned plane even when they select the same transform', () => {
  for (const rows of CANOPY_JITTER.map((_, index) => canopy_rotation(index * CANOPY_YAW_STEP + CANOPY_YAW_OFFSET))) {
    for (const row of rows) {
      // For each plane normal, a one-cell translation along any grid axis has nonzero separation.
      for (const component of row) expect(Math.abs(component * 4)).toBeGreaterThan(0.001)
      expect(Math.hypot(...row)).toBeCloseTo(1, 6)
    }
  }
  // A cube corner reaches at most sqrt(3) times half-size after rotation, plus jitter.
  expect((CANOPY_LOD.far.size * Math.sqrt(3)) / 2 + 1 - CANOPY_LOD.far.step / 2).toBeLessThan(CANOPY_BOUNDS_MARGIN)
})

test('cluster transforms depend on world position, not on which chunk or frame produced them', () => {
  expect(canopy_variant([32, 64, -32], [0, 2, 4])).toBe(canopy_variant([0, 64, -64], [32, 2, 36]))
  expect(canopy_variant([0, 0, 0], [-32, 8, 4])).toBe(canopy_variant([0, 0, 0], [-32, 8, 4]))
  const variants = new Set(Array.from({ length: 16 }, (_, index) => canopy_variant([0, 0, 0], [index * 4, 8, 4])))
  expect(variants.size).toBeGreaterThan(4)
})
