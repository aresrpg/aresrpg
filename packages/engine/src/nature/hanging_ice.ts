// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { pixel_cross, type PixelCell, type SpriteBuilder } from './sprite_kit.ts'

/** Three tapered frost teeth on crossed opaque pixel planes; no alpha sorting or blocks. */
export const hanging_ice: SpriteBuilder = (random) => {
  const cells: PixelCell[] = []
  for (const [offset, length] of [
    [-4, 9],
    [0, 17],
    [4, 12],
  ]) {
    for (let row = 0; row < length!; row++) {
      const half = Math.floor((1 - row / length!) * 1.8)
      for (let column = -half; column <= half; column++)
        cells.push([offset! + column, row, Math.min(2, Math.floor(random() * 2) + Number(column >= 0))])
    }
  }
  return pixel_cross(cells).map(([x, y, z, blend]) => [x, -y, z, blend, 0] as const)
}
