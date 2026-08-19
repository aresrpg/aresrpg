// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Stepped diagonal blades — the classic tall-grass sprite, drawn column by column.

import { pixel_cross, randint, type PixelCell, type SpriteBuilder } from './sprite_kit.ts'

export const herb_tall_grass: SpriteBuilder = (random) => {
  const blades = randint(random, 4, 6)
  const cells: PixelCell[] = []
  for (let index = 0; index < blades; index += 1) {
    const start_x = randint(random, -4, 4)
    const rows = randint(random, 7, 13)
    const drift = randint(random, -1, 1)
    const step_every = randint(random, 2, 4)
    for (let row = 0; row < rows; row += 1) {
      const x = start_x + Math.floor(row / step_every) * drift
      const band = row >= rows - 2 ? 2 : row < rows * 0.4 ? 0 : 1
      cells.push([x, row, band])
    }
  }
  return pixel_cross(cells)
}
