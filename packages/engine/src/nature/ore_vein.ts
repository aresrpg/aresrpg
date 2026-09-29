// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { stone_lump } from './stone_lump.ts'
import { quad, type RecipeVertex, type SpriteBuilder } from './sprite_kit.ts'

/** Faceted, tilted quartz points grow from an irregular ore base; UV height separates stone from crystal. */
export const ore_vein: SpriteBuilder = (random) => {
  const vertices: RecipeVertex[] = [...stone_lump(random, 0, 0, 0.58, 0.3)]
  for (let crystal = 0; crystal < 3; crystal++) {
    const angle = crystal * 2.399 + random(),
      height = 0.5 + random() * 0.55,
      radius = 0.1 + random() * 0.055
    const x = Math.cos(angle) * 0.23,
      z = Math.sin(angle) * 0.23,
      lean_x = Math.cos(angle) * height * 0.28,
      lean_z = Math.sin(angle) * height * 0.28
    for (let side = 0; side < 6; side++) {
      const a = (side * Math.PI) / 3,
        b = ((side + 1) * Math.PI) / 3
      const point = (theta: number, y: number, lean: number, u: number, v: number): RecipeVertex => [
        x + Math.cos(theta) * radius + lean_x * lean,
        y,
        z + Math.sin(theta) * radius + lean_z * lean,
        0.45 + lean * 0.45,
        0,
        u,
        v,
      ]
      const low_a = point(a, 0.18, 0, 0, 0.3),
        low_b = point(b, 0.18, 0, 1, 0.3),
        high_a = point(a, height, 0.75, 0, 0.82),
        high_b = point(b, height, 0.75, 1, 0.82)
      vertices.push(...quad(low_a, low_b, high_b, high_a), high_a, high_b, [
        x + lean_x,
        height + 0.2,
        z + lean_z,
        1,
        0,
        0.5,
        1,
      ])
    }
  }
  return vertices
}
