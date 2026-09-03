// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { pixel_cross, randint, type PixelCell, type SpriteBuilder } from '../../../nature/sprite_kit.ts'

export const thebes_dry_reed: SpriteBuilder = (random) => {
  const height = randint(random, 7, 11)
  const cells: PixelCell[] = []
  for (const x of [-2, 0, 2]) {
    const stalk = height - randint(random, 0, 3)
    for (let y = 0; y <= stalk; y += 1) cells.push([x, y, y === stalk ? 2 : y < 3 ? 0 : 1])
  }
  return pixel_cross(cells)
}
