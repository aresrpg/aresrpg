// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { pixel_cross, randint, type PixelCell, type SpriteBuilder } from '../../../nature/sprite_kit.ts'

export const thebes_courtyard_shrub: SpriteBuilder = (random) => {
  const height = randint(random, 5, 7)
  const cells = Array.from({ length: height }, (_, y): readonly PixelCell[] => {
    const half = y < 2 ? 1 : y < height - 1 ? 3 : 2
    return Array.from({ length: half * 2 + 1 }, (_, index) => index - half).flatMap((x) =>
      random() > 0.18 ? [[x, y, y === height - 1 ? 2 : 1] as PixelCell] : []
    )
  }).flat()
  return pixel_cross(cells)
}
