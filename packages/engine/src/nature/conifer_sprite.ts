// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { pixel_cross, type PixelCell, type SpriteBuilder } from './sprite_kit.ts'

/** Sparse distant bough silhouettes. The authored accent can be snow or sunlit foliage. */
export const conifer_sprite: SpriteBuilder = () => {
  const cells: PixelCell[] = Array.from({ length: 30 }, (_, row) => [0, row, 0] as const)
  for (let tier = 0; tier < 6; tier++)
    for (let row = 0; row < 8; row++) {
      const half = Math.round((7 - tier) * (1 - row / 8))
      for (let column = -half; column <= half; column++)
        cells.push([column, 4 + tier * 4 + row, Math.abs(column) === half ? 2 : 1])
    }
  return pixel_cross(cells)
}
