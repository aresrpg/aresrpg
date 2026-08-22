// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { box, randint, type RecipeVertex, type SpriteBuilder } from './sprite_kit.ts'

/** A grounded rock knuckle with three stepped crystal prisms. Minerals never sway. */
export const ore_vein: SpriteBuilder = (random) => {
  const vertices: RecipeVertex[] = [...box(0, 0, 0, 0.5, 0.28, 0.42, 0)]
  ;[
    [-0.24, -0.08],
    [0.05, 0.08],
    [0.28, -0.1],
  ].forEach(([x, z], index) => {
    const height = randint(random, 4 + index, 6 + index) * 0.1
    vertices.push(...box(x!, 0.2, z!, 0.12, height, 0.1, index === 1 ? 1 : 0.55))
  })
  return vertices
}
