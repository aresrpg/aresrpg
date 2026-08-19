// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// A notched leafy blob — wide base, stepped shrink, bright ragged crown.

import { pixel_cross, randint, type PixelCell, type SpriteBuilder } from './sprite_kit.ts'

export const herb_bush: SpriteBuilder = (random) => {
  const rows = randint(random, 6, 9)
  const base_half = randint(random, 3, 5)
  const cells: PixelCell[] = []
  for (let row = 0; row < rows; row += 1) {
    const half = Math.max(1, Math.round(base_half * (1 - (row / rows) ** 1.6)))
    for (let x = -half; x <= half; x += 1) {
      if (Math.abs(x) === half && random() < 0.35) continue
      const band = row >= rows - 2 ? (random() < 0.5 ? 2 : 1) : row < rows * 0.35 ? 0 : 1
      cells.push([x, row, band])
    }
  }
  return pixel_cross(cells)
}
