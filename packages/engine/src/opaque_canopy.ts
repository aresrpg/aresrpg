// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { GreedyMeshData } from './greedy_mesher.ts'
import { CANOPY_JITTER, CANOPY_LOD, canopy_variant } from './canopy_transforms.ts'
import type { ChunkLod, Vec3 } from './types.ts'
import type { CompiledMaterials } from './world_materials.ts'

/** Foliage faces 6/7 are opposing faces of a closed clump, not coincident card windings.
 * Word A holds the center. Word B holds material, quarter-block size (12..17), axis (18..19),
 * source AO (20..27) and deterministic transform (28..31). */
// Cell centers already sit half a step inside the chunk. Only the rotated overhang
// extends its culling bounds; padding by the entire clump radius retains invisible chunks.
export const CANOPY_BOUNDS_MARGIN = Math.ceil(
  Math.max(
    ...Object.values(CANOPY_LOD).map(
      ({ size, step }) => (size * Math.sqrt(3)) / 2 + Math.max(...CANOPY_JITTER.flat().map(Math.abs)) - step / 2
    )
  )
)
export const validate_canopy = (value: unknown): readonly string[] =>
  [undefined, 'voxels', 'clusters'].some((candidate) => candidate === value)
    ? []
    : ['canopy must be voxels or clusters']

const cluster_points = (quads: readonly number[], step: number): readonly (readonly number[])[] => {
  const side = 32 / step
  const cells = new Map<number, readonly number[]>()
  for (let index = 0; index < quads.length; index += 2) {
    const a = quads[index]!
    const face = (a >>> 28) & 7
    const axis = Math.floor(face / 2)
    const point = [a & 63, (a >>> 6) & 63, (a >>> 12) & 63]
    // Surface cards could sit on a face boundary; a solid clump must be anchored
    // to the occupied cell behind that face, never the empty neighbouring cell.
    point[axis] += 0.5
    const u = axis === 0 ? 1 : 0
    const v = axis === 2 ? 1 : 2
    const width = ((a >>> 18) & 31) + 1
    const height = ((a >>> 23) & 31) + 1
    const columns = Math.ceil(width / step)
    for (let tile = 0; tile < columns * Math.ceil(height / step); tile += 1) {
      const x = (tile % columns) * step
      const y = Math.floor(tile / columns) * step
      const center = [...point]
      center[u] += Math.min(x + step / 2, width - 0.5)
      center[v] += Math.min(y + step / 2, height - 0.5)
      const cell = center.map((value) => Math.min(side - 1, Math.floor(value / step)))
      const key = cell[0]! + side * cell[1]! + side * side * cell[2]!
      cells.set(key, cells.get(key) ?? [...cell.map((value) => value * step + step / 2), quads[index + 1]!])
    }
  }
  return [...cells.values()]
}

const leaf_cluster = (
  [x, y, z, source_appearance]: readonly number[],
  size: number,
  variant: number
): readonly number[] => {
  const jitter = size >= 3 ? CANOPY_JITTER[variant]! : [0, 0, 0]
  const position = (x! + jitter[0]! + 1) | ((y! + jitter[1]! + 1) << 6) | ((z! + jitter[2]! + 1) << 12)
  return Array.from({ length: 3 }, (_, axis) => {
    const appearance = (source_appearance! & 0x0ff00fff) | ((size * 4) << 12) | (axis << 18) | (variant << 28)
    return [(position | (6 << 28)) >>> 0, appearance >>> 0, (position | (7 << 28)) >>> 0, appearance >>> 0]
  }).flat()
}

export const opaque_canopy_mesh = (
  mesh: GreedyMeshData,
  materials: CompiledMaterials,
  lod: ChunkLod,
  origin: Vec3 = [0, 0, 0]
): GreedyMeshData => {
  const solid: number[] = []
  const foliage: number[] = []
  for (let index = 0; index < mesh.quads.length; index += 2) {
    const a = mesh.quads[index]!
    const b = mesh.quads[index + 1]!
    const target = materials.entries[b & 0xfff]!.preset === 'foliage' ? foliage : solid
    target.push(a, b)
  }
  const { step, size } = CANOPY_LOD[lod]
  const leaves = cluster_points(foliage, step).flatMap((cluster) =>
    leaf_cluster(cluster, size, canopy_variant(origin, cluster))
  )
  const quads = new Uint32Array([...solid, ...leaves])
  return { quads, quad_count: quads.length / 2 }
}
