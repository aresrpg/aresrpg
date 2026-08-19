// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Sedge — a few tall, strictly upright stalks; one carries a dark seed head. Reads as reeds and
// meadow accents between the drifting tall-grass clumps.

import { pixel_cross, randint, type PixelCell, type SpriteBuilder } from './sprite_kit.ts'

export const herb_sedge: SpriteBuilder = (random) => {
  const stalks = randint(random, 3, 4)
  const cells: PixelCell[] = []
  const head_stalk = randint(random, 0, stalks - 1)
  for (let index = 0; index < stalks; index += 1) {
    const x = randint(random, -2, 2)
    const rows = randint(random, 10, 15)
    for (let row = 0; row < rows; row += 1) cells.push([x, row, row < rows * 0.35 ? 0 : 1])
    if (index === head_stalk) cells.push([x, rows, 0], [x, rows + 1, 0])
    else cells.push([x, rows, 2])
  }
  return pixel_cross(cells)
}
