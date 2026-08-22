// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { pixel_cross, randint, type PixelCell, type SpriteBuilder } from './sprite_kit.ts'

/** A compact gatherable herb: rooted leaves around one bright flower, cap, or spore head. */
export const flora_cluster: SpriteBuilder = (random) => {
  const height = randint(random, 5, 8)
  const cells: PixelCell[] = Array.from({ length: height }, (_, y) => [0, y, y < 2 ? 0 : 1])
  cells.push([-1, 1, 1], [1, 1, 1], [-1, 2, 1], [1, 2, 1])
  cells.push([-1, height - 1, 2], [0, height - 1, 2], [1, height - 1, 2])
  return pixel_cross(cells)
}
