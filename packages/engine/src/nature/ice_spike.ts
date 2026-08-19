// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// A stepped voxel stalagmite — stacked shrinking boxes brightening toward the tip.

import { box, randint, type RecipeVertex, type SpriteBuilder } from './sprite_kit.ts'

export const ice_spike: SpriteBuilder = (random) => {
  const levels = randint(random, 3, 4)
  const base_half = 0.24 + random() * 0.08
  const level_height = 0.16 + random() * 0.05
  let y = 0
  const parts: RecipeVertex[] = []
  for (let level = 0; level < levels; level += 1) {
    const half = base_half * (1 - level / levels) + 0.03
    const jitter_x = (random() - 0.5) * 0.06
    const jitter_z = (random() - 0.5) * 0.06
    parts.push(...box(jitter_x, y, jitter_z, half, level_height, half, level / (levels - 1)))
    y += level_height
  }
  return parts
}
