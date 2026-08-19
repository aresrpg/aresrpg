// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// A squat toadstool — two-cell stem under a fat stepped cap.

import { pixel_cross, randint, type PixelCell, type SpriteBuilder } from './sprite_kit.ts'

export const mushroom_toadstool: SpriteBuilder = (random) => {
  const stem_rows = randint(random, 2, 3)
  const cap_half = randint(random, 2, 3)
  const cells: PixelCell[] = []
  for (let row = 0; row < stem_rows; row += 1) cells.push([0, row, 1], [random() < 0.5 ? 1 : -1, 0, 1])
  for (let row = 0; row <= cap_half; row += 1) {
    const half = Math.max(0, cap_half - row)
    for (let x = -half; x <= half; x += 1) cells.push([x, stem_rows + row, 2])
  }
  return pixel_cross(cells)
}
