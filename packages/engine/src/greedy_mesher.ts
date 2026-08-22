// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable max-depth -- the measured meshing hot path keeps its nested spatial scan explicit. */

import type { ChunkRenderData } from './types.ts'
import { CHUNK_EDGE, halo_index, voxel_index } from './voxel_data.ts'

const ROWS_PER_AXIS = CHUNK_EDGE * CHUNK_EDGE
const MATERIAL_ID_MASK = 0xfff
const FULL_SUN_WORD = (7 << 12) | (7 << 15) | (3 << 18)
const OPEN_AO = 0xff
const ALL_EDGES_CONVEX = 0b1111
// The shared quad basis points inward for -X, +Y, and -Z. The vertex shader mirrors U for these faces.
export const FACE_WINDING_FLIP_BITS = 0b100110
export type GreedyMeshData = Readonly<{
  // Compact GPU contract: word A owns geometry; word B owns the recipe's material id, the
  // reserved light fields, the AO corners (bits 20-27), and the convex-edge flags (bits 28-31:
  // u-low, u-high, v-low, v-high) that drive the rounded-corner normal bend.
  quads: Uint32Array
  quad_count: number
}>

const encode_geometry = (
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  face: number,
  material_id: number,
  ao = OPEN_AO,
  edges = ALL_EDGES_CONVEX
): readonly [number, number] => [
  (x | (y << 6) | (z << 12) | ((width - 1) << 18) | ((height - 1) << 23) | (face << 28)) >>> 0,
  ((material_id & MATERIAL_ID_MASK) |
    FULL_SUN_WORD |
    ((ao & 0x3) << 20) |
    (((ao >>> 2) & 0x3) << 22) |
    (((ao >>> 4) & 0x3) << 24) |
    (((ao >>> 6) & 0x3) << 26) |
    ((edges & 0xf) << 28)) >>>
    0,
]

const assert_chunk = ({ resolution, occupancy, material_ids }: ChunkRenderData): void => {
  if (!Number.isInteger(resolution) || resolution < 1 || resolution > CHUNK_EDGE)
    throw new TypeError(`binary chunk resolution must be within 1..${CHUNK_EDGE}`)
  if (occupancy.some((axis) => axis.length !== ROWS_PER_AXIS))
    throw new TypeError(`each occupancy axis needs ${ROWS_PER_AXIS} words`)
  if (material_ids.length !== CHUNK_EDGE ** 3) throw new TypeError(`material ids need ${CHUNK_EDGE ** 3} entries`)
}

const voxel_coordinates = (axis: number, row: number, bit: number): readonly [number, number, number] => {
  const high = row >>> 5
  const low = row & 31
  if (axis === 0) return [bit, high, low]
  if (axis === 1) return [high, bit, low]
  return [high, low, bit]
}

const halo_solid = ({ halo_occupancy }: ChunkRenderData, x: number, y: number, z: number): boolean => {
  const index = halo_index(x, y, z)
  return ((halo_occupancy[index >>> 5] ?? 0) & (1 << (index & 31))) !== 0
}

const face_neighbor_solid = (
  chunk: ChunkRenderData,
  axis: number,
  normal: number,
  x: number,
  y: number,
  z: number,
  u: number,
  v: number
): boolean => {
  if (axis === 0) return halo_solid(chunk, x + normal, y + u, z + v)
  if (axis === 1) return halo_solid(chunk, x + u, y + normal, z + v)
  return halo_solid(chunk, x + u, y + v, z + normal)
}

const corner_ao = (side_u: boolean, side_v: boolean, corner: boolean): number =>
  side_u && side_v ? 0 : 3 - Number(side_u) - Number(side_v) - Number(corner)

const face_ao = (chunk: ChunkRenderData, axis: number, positive: boolean, x: number, y: number, z: number): number => {
  const normal = positive ? 1 : -1
  const side_nu = face_neighbor_solid(chunk, axis, normal, x, y, z, -1, 0)
  const side_pu = face_neighbor_solid(chunk, axis, normal, x, y, z, 1, 0)
  const side_nv = face_neighbor_solid(chunk, axis, normal, x, y, z, 0, -1)
  const side_pv = face_neighbor_solid(chunk, axis, normal, x, y, z, 0, 1)
  const ao_0 = corner_ao(side_nu, side_nv, face_neighbor_solid(chunk, axis, normal, x, y, z, -1, -1))
  const ao_1 = corner_ao(side_pu, side_nv, face_neighbor_solid(chunk, axis, normal, x, y, z, 1, -1))
  const ao_2 = corner_ao(side_nu, side_pv, face_neighbor_solid(chunk, axis, normal, x, y, z, -1, 1))
  const ao_3 = corner_ao(side_pu, side_pv, face_neighbor_solid(chunk, axis, normal, x, y, z, 1, 1))
  return ao_0 | (ao_1 << 2) | (ao_2 << 4) | (ao_3 << 6)
}

const visible_words = (chunk: ChunkRenderData, axis: number, positive: boolean, row: number): number => {
  const word = chunk.occupancy[axis][row] ?? 0
  const mask = chunk.resolution === 32 ? 0xffffffff : (1 << chunk.resolution) - 1
  let visible = positive ? word & ~(word >>> 1) : word & ~(word << 1)
  visible &= mask
  if (positive && halo_solid(chunk, ...voxel_coordinates(axis, row, chunk.resolution)))
    visible &= ~(1 << (chunk.resolution - 1))
  if (!positive && halo_solid(chunk, ...voxel_coordinates(axis, row, -1))) visible &= 0xfffffffe
  return visible >>> 0
}

const projected_coordinates = (axis: number, x: number, y: number, z: number): readonly [number, number, number] => {
  if (axis === 0) return [x, y, z]
  if (axis === 1) return [y, x, z]
  return [z, x, y]
}

// A face cell's convex edges: sides where NO same-level neighbour continues the surface in the
// face's own plane. Baked into the merge class, so greedy quads only merge cells with identical
// convexity — the per-quad border rounding is then exact for every cell (a strip's open lip is
// always the quad's own border).
const cell_edge_flags = (chunk: ChunkRenderData, axis: number, x: number, y: number, z: number): number => {
  const open = (du: number, dv: number): number => (face_neighbor_solid(chunk, axis, 0, x, y, z, du, dv) ? 0 : 1)
  return open(-1, 0) | (open(1, 0) << 1) | (open(0, -1) << 2) | (open(0, 1) << 3)
}

const emit_direction = (
  chunk: ChunkRenderData,
  axis: number,
  positive: boolean,
  plane_faces: Uint32Array,
  output: number[]
): void => {
  const { resolution } = chunk
  plane_faces.fill(0)

  for (let high = 0; high < resolution; high += 1) {
    for (let low = 0; low < resolution; low += 1) {
      const row = high * CHUNK_EDGE + low
      let visible = visible_words(chunk, axis, positive, row)
      while (visible !== 0) {
        const bit_mask = visible & -visible
        const bit = 31 - Math.clz32(bit_mask)
        visible = (visible & (visible - 1)) >>> 0
        const [x, y, z] = voxel_coordinates(axis, row, bit)
        const [depth, u, v] = projected_coordinates(axis, x, y, z)
        const material_id = chunk.material_ids[voxel_index(x, y, z)] ?? 0
        const ao = face_ao(chunk, axis, positive, x, y, z)
        const edges = cell_edge_flags(chunk, axis, x, y, z)
        plane_faces[depth * CHUNK_EDGE * CHUNK_EDGE + v * CHUNK_EDGE + u] = material_id | (ao << 12) | (edges << 20)
      }
    }
  }

  for (let depth = 0; depth < resolution; depth += 1) {
    for (let v = 0; v < resolution; v += 1) {
      for (let u = 0; u < resolution; u += 1) {
        const index = depth * CHUNK_EDGE * CHUNK_EDGE + v * CHUNK_EDGE + u
        const face_class = plane_faces[index] ?? 0
        if (face_class === 0) continue
        let width = 1
        while (u + width < resolution && plane_faces[index + width] === face_class) width += 1
        let height = 1
        height_loop: while (v + height < resolution) {
          const next_row = index + height * CHUNK_EDGE
          for (let offset = 0; offset < width; offset += 1)
            if (plane_faces[next_row + offset] !== face_class) break height_loop
          height += 1
        }
        for (let offset = 0; offset < height; offset += 1)
          plane_faces.fill(0, index + offset * CHUNK_EDGE, index + offset * CHUNK_EDGE + width)

        const x = axis === 0 ? depth : u
        const y = axis === 0 ? u : axis === 1 ? depth : v
        const z = axis === 2 ? depth : v
        output.push(
          ...encode_geometry(
            x,
            y,
            z,
            width,
            height,
            axis * 2 + (positive ? 0 : 1),
            face_class & MATERIAL_ID_MASK,
            (face_class >>> 12) & 0xff,
            face_class >>> 20
          )
        )
      }
    }
  }
}

export const greedy_mesh = (chunk: ChunkRenderData): GreedyMeshData => {
  assert_chunk(chunk)
  // Sky/underground chunks with zero voxels skip the whole pass (perf audit: 0.23 ms + 131 KB
  // of scratch per empty chunk, and half the vertical layers are empty). A FRESH array every
  // time — the worker TRANSFERS the buffer away, so a shared singleton detaches after one use.
  if (chunk.occupancy[0].every((word) => word === 0)) return Object.freeze({ quads: new Uint32Array(0), quad_count: 0 })
  const quads: number[] = []
  const plane_faces = new Uint32Array(CHUNK_EDGE ** 3)
  for (let axis = 0; axis < 3; axis += 1) {
    emit_direction(chunk, axis, false, plane_faces, quads)
    emit_direction(chunk, axis, true, plane_faces, quads)
  }
  const packed = Uint32Array.from(quads)
  return Object.freeze({ quads: packed, quad_count: packed.length / 2 })
}
