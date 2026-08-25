// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// A gatherable mushroom patch. Unlike terrain scatter's crossed sprite, these caps need to
// survive close inspection: stepped boxes give every stem a grounded, unmistakably 3D crown.

import { box, type RecipeVertex, type SpriteBuilder } from './sprite_kit.ts'

const mushroom = (x: number, z: number, height: number, radius: number): readonly RecipeVertex[] => [
  ...box(x, 0, z, radius * 0.24, height, radius * 0.24, 0.08),
  ...box(x, height, z, radius, radius * 0.28, radius * 0.9, 0.78),
  ...box(x, height + radius * 0.28, z, radius * 0.68, radius * 0.22, radius * 0.62, 1),
]

const MUSHROOMS = Object.freeze([
  [0, 0, 0.68, 0.34],
  [-0.42, 0.14, 0.48, 0.25],
  [0.4, 0.2, 0.55, 0.28],
  [-0.24, -0.35, 0.38, 0.22],
  [0.3, -0.34, 0.44, 0.24],
] as const)

/** Five varied caps read as a harvestable colony rather than one decorative toadstool. */
export const mushroom_cluster: SpriteBuilder = (random) =>
  Object.freeze(
    MUSHROOMS.flatMap(([x, z, height, radius]) => {
      const scale = 0.9 + random() * 0.18
      return mushroom(x + (random() - 0.5) * 0.06, z + (random() - 0.5) * 0.06, height * scale, radius * scale)
    })
  )
