// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Two or three squat voxel blocks half-sunk into the ground, each with a lighter top step.

import { box, randint, type SpriteBuilder } from './sprite_kit.ts'

export const rock_pebbles: SpriteBuilder = (random) => {
  const stones = randint(random, 2, 3)
  return Array.from({ length: stones }, (_, index) => {
    const half = 0.09 + random() * 0.09
    const offset_x = index === 0 ? 0 : (random() - 0.5) * 0.5
    const offset_z = index === 0 ? 0 : (random() - 0.5) * 0.5
    const height = half * (0.9 + random() * 0.5)
    return [
      ...box(offset_x, -0.03, offset_z, half, height, half * (0.8 + random() * 0.4), 0),
      ...box(offset_x, -0.03 + height, offset_z, half * 0.55, height * 0.4, half * 0.5, 0.35),
    ]
  }).flat()
}
