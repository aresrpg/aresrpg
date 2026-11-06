// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { raster_portrait_coverage } from '../portrait_coverage.mjs'

test('overlapping antialiased portrait regions use the same alpha rounding on every platform', () => {
  // Iyashi female hair geometry from regions.json, captured 2026-11-06.
  // Native ARM64 composition yielded 221/96; x64 yielded 220/97 for these same individual alphas.
  const coverage = raster_portrait_coverage({
    polygons: [
      [
        [271, 180],
        [299, 188],
        [291, 218],
        [276, 231],
        [260, 227],
      ],
      [
        [298, 187],
        [326, 194],
        [319, 216],
        [295, 215],
      ],
    ],
    exclude: [],
  })
  expect(coverage[388 * 1024 + 594]).toBe(221)
  expect(coverage[393 * 1024 + 593]).toBe(96)
})

test('exclusions remove coverage without affecting unrelated regions or empty pixels', () => {
  const coverage = raster_portrait_coverage({
    polygons: [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
    ],
    exclude: [
      [
        [0, 0],
        [5, 0],
        [5, 10],
        [0, 10],
      ],
    ],
  })
  expect(coverage[5 * 1024 + 5]).toBe(0)
  expect(coverage[5 * 1024 + 15]).toBe(255)
  expect(coverage[25 * 1024 + 25]).toBe(0)
})
