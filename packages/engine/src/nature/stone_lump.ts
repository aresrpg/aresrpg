// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { quad, type RecipeVertex } from './sprite_kit.ts'

/** Irregular shoulder and offset crown; the bottom lies below ground and UVs use the atlas's stone band. */
export const stone_lump = (
  random: () => number,
  x: number,
  z: number,
  radius: number,
  height: number
): readonly RecipeVertex[] => {
  const ring = Array.from({ length: 7 }, (_, index) => {
    const angle = (index * Math.PI * 2) / 7,
      r = radius * (0.75 + random() * 0.25)
    return [x + Math.cos(angle) * r, height * (0.35 + random() * 0.25), z + Math.sin(angle) * r] as const
  })
  const crown: RecipeVertex = [x + radius * 0.16, height, z - radius * 0.12, 0.25, 0, 0.5, 0.12]
  return ring.flatMap((a, index) => {
    const b = ring[(index + 1) % ring.length]!
    const left: RecipeVertex = [a[0], a[1], a[2], 0.12, 0, 0, 0.24],
      right: RecipeVertex = [b[0], b[1], b[2], 0.18, 0, 1, 0.24]
    return [
      ...quad([a[0], -0.035, a[2], 0, 0, 0, 0], [b[0], -0.035, b[2], 0, 0, 1, 0], right, left),
      left,
      right,
      crown,
    ]
  })
}
