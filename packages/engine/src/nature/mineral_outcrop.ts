// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { quad, type RecipeVertex } from './sprite_kit.ts'

type Triple = readonly number[]
export type MineralVisual = Readonly<{
  palette: readonly string[]
  patterns: Readonly<Record<string, readonly string[]>>
  blocks: readonly Readonly<{ min: Triple; size: Triple; side: string; top: string }>[]
}>

// Outward-wound face frames share the authored pixel atlas within one instanced draw.
const FACES = [
  { origin: [0, 1, 1], u: [1, 0, 0], v: [0, 0, -1] },
  { origin: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { origin: [1, 0, 0], u: [-1, 0, 0], v: [0, 1, 0] },
  { origin: [1, 0, 1], u: [0, 0, -1], v: [0, 1, 0] },
  { origin: [0, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1] },
] as const

/** Closed blocks also cover exposed undersides in stepped and cleft mineral forms. */
export const mineral_outcrop = (visual: MineralVisual): readonly RecipeVertex[] => {
  const names = Object.keys(visual.patterns)
  const width = visual.patterns[names[0]!]![0]!.length
  const height = visual.patterns[names[0]!]!.length
  return visual.blocks.flatMap((block) =>
    FACES.flatMap((frame, face) => {
      const tile = names.indexOf(face === 0 ? block.top : block.side)
      const point = (u: number, v: number): RecipeVertex => [
        ...([0, 1, 2].map(
          (axis) =>
            block.min[axis]! + block.size[axis]! * (frame.origin[axis]! + frame.u[axis]! * u + frame.v[axis]! * v)
        ) as [number, number, number]),
        0,
        0,
        (1 + u * width) / (width + 2),
        (tile * (height + 2) + 1 + v * height) / ((height + 2) * names.length),
      ]
      return quad(point(0, 0), point(1, 0), point(1, 1), point(0, 1))
    })
  )
}
