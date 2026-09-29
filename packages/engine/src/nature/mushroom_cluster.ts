// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { quad, type RecipeVertex, type SpriteBuilder } from './sprite_kit.ts'

type Ring = readonly [height: number, radius: number, blend: number, v: number]
const radial_surface = (x: number, z: number, rings: readonly Ring[], segments: number): readonly RecipeVertex[] =>
  rings.slice(1).flatMap((upper, ring) => {
    const lower = rings[ring]!
    return Array.from({ length: segments }, (_, segment) => {
      const vertex = ([height, radius, blend, v]: Ring, angle: number): RecipeVertex => [
        x + Math.cos(angle) * radius,
        height,
        z + Math.sin(angle) * radius,
        blend,
        0,
        angle / (Math.PI * 2),
        v,
      ]
      const a = (segment * Math.PI * 2) / segments
      const b = ((segment + 1) * Math.PI * 2) / segments
      return quad(vertex(lower, a), vertex(upper, a), vertex(upper, b), vertex(lower, b))
    }).flat()
  })

/** Faceted domes and a pale radial underside hold their shape from every camera angle. */
export const mushroom = (x: number, z: number, height: number, radius: number): readonly RecipeVertex[] => [
  ...radial_surface(
    x,
    z,
    [
      [0, radius * 0.18, 0.05, 0.02],
      [height * 0.7, radius * 0.12, 0.2, 0.22],
      [height, radius * 0.19, 0.32, 0.3],
    ],
    8
  ),
  ...radial_surface(
    x,
    z,
    [
      [height * 0.94, radius * 0.14, 0.18, 0.36],
      [height, radius, 0.45, 0.6],
      [height + radius * 0.14, radius * 1.04, 0.72, 0.68],
      [height + radius * 0.46, radius * 0.76, 0.92, 0.79],
      [height + radius * 0.65, radius * 0.34, 1, 0.9],
      [height + radius * 0.7, 0, 0.88, 0.98],
    ],
    12
  ),
]

const MUSHROOMS = Object.freeze([
  [0, 0, 0.78, 0.42],
  [-0.46, 0.17, 0.48, 0.25],
  [0.44, 0.24, 0.58, 0.32],
  [-0.24, -0.4, 0.32, 0.2],
  [0.34, -0.34, 0.43, 0.26],
] as const)

export const mushroom_cluster: SpriteBuilder = (random) =>
  Object.freeze(
    MUSHROOMS.flatMap(([x, z, height, radius]) => {
      const scale = 0.82 + random() * 0.36
      return mushroom(x + (random() - 0.5) * 0.12, z + (random() - 0.5) * 0.12, height * scale, radius * scale)
    })
  )
