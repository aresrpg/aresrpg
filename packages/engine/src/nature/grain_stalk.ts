// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  CELL,
  pixel_cross,
  randint,
  rotate_y,
  type PixelCell,
  type RecipeVertex,
  type SpriteBuilder,
} from './sprite_kit.ts'

const STALK_ROOTS = Object.freeze([
  [-3, -2],
  [0, -3],
  [3, -2],
  [-4, 1],
  [-1, 0],
  [2, 0],
  [4, 1],
  [-3, 3],
  [0, 3],
  [3, 3],
  [-2, -1],
  [1, -2],
  [-2, 2],
  [1, 1],
  [3, 0],
] as const)

const single_stalk = (random: () => number): readonly RecipeVertex[] => {
  const height = randint(random, 10, 13)
  const lean = random() < 0.5 ? -1 : 1
  const cells: PixelCell[] = Array.from({ length: height }, (_, y) => [0, y, y < 3 ? 0 : 1])
  cells.push([lean, height - 3, 2], [lean, height - 2, 2], [lean, height - 1, 2])
  return pixel_cross(cells)
}

/** One gatherable wheat node: a dense, rooted clump of independently oriented stalks. */
export const grain_stalk: SpriteBuilder = (random) => {
  return STALK_ROOTS.flatMap(([root_x, root_z]) => {
    const yaw = random() * Math.PI * 2
    const scale = 0.78 + random() * 0.22
    return single_stalk(random).map((vertex): RecipeVertex => {
      const [x, y, z, blend, sway] = rotate_y(vertex, yaw)
      return [x * scale + root_x * CELL, y * scale, z * scale + root_z * CELL, blend, sway]
    })
  })
}
