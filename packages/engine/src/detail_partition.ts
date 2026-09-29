// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { Vec3 } from './types.ts'
import { CHUNK_EDGE } from './voxel_data.ts'

export type DetailVertex = Readonly<{ position: Vec3; normal: Vec3; uv: readonly [number, number]; material: string }>

const clip = (polygon: readonly DetailVertex[], axis: number, edge: number, sign: number): readonly DetailVertex[] => {
  const result: DetailVertex[] = []
  polygon.forEach((a, index) => {
    const b = polygon[(index + 1) % polygon.length]!
    const inside_a = (a.position[axis]! - edge) * sign >= 0
    const inside_b = (b.position[axis]! - edge) * sign >= 0
    if (inside_a) result.push(a)
    if (inside_a === inside_b) return
    const t = (edge - a.position[axis]!) / (b.position[axis]! - a.position[axis]!)
    result.push({
      ...a,
      position: a.position.map((value, axis) => value + (b.position[axis]! - value) * t) as unknown as Vec3,
      uv: [a.uv[0] + (b.uv[0] - a.uv[0]) * t, a.uv[1] + (b.uv[1] - a.uv[1]) * t],
    })
  })
  return result
}

const split_axis = (polygon: readonly DetailVertex[], axis: number): readonly (readonly DetailVertex[])[] => {
  const min = Math.min(...polygon.map((v) => v.position[axis]!))
  const max = Math.max(...polygon.map((v) => v.position[axis]!))
  const first = Math.floor(min / CHUNK_EDGE)
  const last = Math.max(first, Math.ceil(max / CHUNK_EDGE) - 1)
  return Array.from({ length: last - first + 1 }, (_, index) => {
    const edge = (first + index) * CHUNK_EDGE
    return clip(clip(polygon, axis, edge, 1), axis, edge + CHUNK_EDGE, -1)
  }).filter((row) => row.length >= 3)
}

/** Clip during baking so every batch has exact cell bounds and follows that cell's residency. */
export const partition_detail_triangle = (triangle: readonly DetailVertex[]): readonly (readonly DetailVertex[])[] =>
  [0, 1, 2]
    .reduce<readonly (readonly DetailVertex[])[]>(
      (polygons, axis) => polygons.flatMap((polygon) => split_axis(polygon, axis)),
      [triangle]
    )
    .flatMap((polygon) =>
      Array.from({ length: polygon.length - 2 }, (_, index) => [polygon[0]!, polygon[index + 1]!, polygon[index + 2]!])
    )
