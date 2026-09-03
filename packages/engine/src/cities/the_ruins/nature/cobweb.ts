// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { pixel_cross, randint, type PixelCell, type SpriteBuilder } from '../../../nature/sprite_kit.ts'

const web_row = (row: number, height: number): readonly PixelCell[] => {
  const half = Math.max(1, Math.round((row / height) * 5))
  const cross_threads =
    row % 3 === 0
      ? Array.from({ length: half + 1 }, (_, index): PixelCell => [
          -half + index * 2,
          row,
          index === 0 || index === half ? 2 : 1,
        ])
      : []
  return Object.freeze([[0, row, row > height * 0.7 ? 2 : 1], ...cross_threads, [-half, row, 1], [half, row, 1]])
}

export const ruins_cobweb: SpriteBuilder = (random) => {
  const height = randint(random, 8, 11)
  return pixel_cross(Array.from({ length: height + 1 }, (_, row) => web_row(row, height)).flat())
}
