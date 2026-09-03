// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { pixel_cross, randint, type PixelCell, type SpriteBuilder } from '../../../nature/sprite_kit.ts'

const stalk = (x: number, height: number, lean: number): readonly PixelCell[] => [
  ...Array.from({ length: height }, (_, y) => [x, y, y >= height - 2 ? 2 : Number(y >= 3)] as PixelCell),
  [x + lean, height - 2, 2],
  [x + lean, height - 1, 2],
]

export const thebes_field_crop: SpriteBuilder = (random) => {
  const cells: PixelCell[] = []
  for (const x of [-3, 0, 3]) {
    const height = randint(random, 8, 12)
    const lean = random() < 0.5 ? -1 : 1
    cells.push(...stalk(x, height, lean))
  }
  return pixel_cross(cells)
}
