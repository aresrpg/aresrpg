// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// A fern frond — central stalk with symmetric stepped side-leaflets that shorten toward the
// bright curled tip.

import { pixel_cross, randint, type PixelCell, type SpriteBuilder } from './sprite_kit.ts'

export const herb_fern: SpriteBuilder = (random) => {
  const rows = randint(random, 9, 12)
  const cells: PixelCell[] = []
  for (let row = 0; row < rows; row += 1) cells.push([0, row, row < rows * 0.35 ? 0 : 1])
  for (let row = 2; row < rows - 1; row += 2) {
    const reach = Math.max(1, Math.round(3 * (1 - row / rows)))
    for (let out = 1; out <= reach; out += 1) {
      cells.push([out, row - Math.floor(out / 2), 1], [-out, row + 1 - Math.floor(out / 2), 1])
    }
  }
  cells.push([0, rows, 2], [random() < 0.5 ? 1 : -1, rows, 2])
  return pixel_cross(cells)
}
