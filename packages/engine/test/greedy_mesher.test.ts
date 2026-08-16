// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { FACE_WINDING_FLIP_BITS, greedy_mesh } from '../src/greedy_mesher.ts'
import type { ChunkRenderData } from '../src/types.ts'
import { CHUNK_EDGE, pack_voxel_occupancy, voxel_index } from '../src/voxel_data.ts'

const chunk = (solid_at: (x: number, y: number, z: number) => boolean): ChunkRenderData => {
  const material_ids = new Uint16Array(CHUNK_EDGE ** 3)
  for (let y = 0; y < CHUNK_EDGE; y += 1)
    for (let z = 0; z < CHUNK_EDGE; z += 1)
      for (let x = 0; x < CHUNK_EDGE; x += 1) if (solid_at(x, y, z)) material_ids[voxel_index(x, y, z)] = 3
  return {
    key: '0:0:0',
    coordinate: { x: 0, y: 0, z: 0 },
    origin: [0, 0, 0],
    lod: 'near',
    resolution: CHUNK_EDGE,
    cell_size: 1,
    material_ids,
    ...pack_voxel_occupancy(solid_at),
  }
}

describe('binary greedy voxel meshing', () => {
  test('marks exactly the face bases whose winding points inward', () => {
    expect(Array.from({ length: 6 }, (_, face) => ((FACE_WINDING_FLIP_BITS >>> face) & 1) === 1)).toEqual([
      false,
      true,
      true,
      false,
      false,
      true,
    ])
  })

  test('a full chunk with matching neighbours emits no internal or boundary faces', () => {
    expect(greedy_mesh(chunk(() => true)).quad_count).toBe(0)
  })

  test('an isolated solid chunk collapses to six quads', () => {
    const data = chunk((x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < CHUNK_EDGE && y < CHUNK_EDGE && z < CHUNK_EDGE)

    expect(greedy_mesh(data).quad_count).toBe(6)
  })

  test('a single voxel emits six packed quads', () => {
    const mesh = greedy_mesh(chunk((x, y, z) => x === 2 && y === 3 && z === 4))

    expect(mesh.quad_count).toBe(6)
    expect(mesh.quads).toHaveLength(12)
    expect(Array.from({ length: mesh.quad_count }, (_, index) => (mesh.quads[index * 2]! >>> 28) & 0x7)).toEqual([
      1, 0, 3, 2, 5, 4,
    ])
    expect(mesh.quads[0]).toBe((2 | (3 << 6) | (4 << 12) | (1 << 28)) >>> 0)
  })

  test('word B carries the source material and prevents cross-material merges', () => {
    const source = chunk((x, y, z) => y === 0 && z === 0 && (x === 0 || x === 1))
    source.material_ids[voxel_index(0, 0, 0)] = 2
    source.material_ids[voxel_index(1, 0, 0)] = 3

    const mesh = greedy_mesh(source)
    const material_ids = Array.from({ length: mesh.quad_count }, (_, index) => mesh.quads[index * 2 + 1]! & 0xfff)

    expect(material_ids).toContain(2)
    expect(material_ids).toContain(3)
    expect(mesh.quad_count).toBe(10)
  })

  test('word B masks material ids without corrupting its full-light defaults', () => {
    const source = chunk((x, y, z) => x === 0 && y === 0 && z === 0)
    source.material_ids[voxel_index(0, 0, 0)] = 0xffff

    const word_b = greedy_mesh(source).quads[1]!

    expect(word_b & 0xfff).toBe(0xfff)
    expect((word_b >>> 12) & 0x7).toBe(7)
    expect((word_b >>> 15) & 0x7).toBe(7)
    expect((word_b >>> 28) & 0x7).toBe(7)
    expect(word_b >>> 31).toBe(1)
    expect((word_b >>> 20) & 0xff).toBe(0xff)
  })

  test('word B carries classic corner occlusion and prevents shading-incompatible merges', () => {
    const source = chunk((x, y, z) => (x === 1 && y === 0 && z === 1) || (x === 0 && y === 1 && z === 1))
    const mesh = greedy_mesh(source)
    const top_index = Array.from({ length: mesh.quad_count }, (_, index) => index).find((index) => {
      const word_a = mesh.quads[index * 2]!
      return (
        ((word_a >>> 28) & 0x7) === 2 &&
        (word_a & 0x3f) === 1 &&
        ((word_a >>> 6) & 0x3f) === 0 &&
        ((word_a >>> 12) & 0x3f) === 1
      )
    })

    expect(top_index).toBeDefined()
    expect((mesh.quads[top_index! * 2 + 1]! >>> 20) & 0xff).toBe(0xee)
  })

  test('varied terrain covers every visible voxel face exactly once', () => {
    const solid_at = (x: number, y: number, z: number): boolean =>
      y >= 0 && y < 6 + Math.round(Math.sin(x * 0.4) * 2 + Math.cos(z * 0.3) * 2)
    const mesh = greedy_mesh(chunk(solid_at))
    const expected = new Set<string>()
    const actual = new Map<string, number>()
    const directions = [
      [-1, 0, 0, 1],
      [1, 0, 0, 0],
      [0, -1, 0, 3],
      [0, 1, 0, 2],
      [0, 0, -1, 5],
      [0, 0, 1, 4],
    ] as const

    for (let y = 0; y < CHUNK_EDGE; y += 1)
      for (let z = 0; z < CHUNK_EDGE; z += 1)
        for (let x = 0; x < CHUNK_EDGE; x += 1) {
          if (!solid_at(x, y, z)) continue
          for (const [dx, dy, dz, face] of directions)
            if (!solid_at(x + dx, y + dy, z + dz)) expected.add([x, y, z, face].join(':'))
        }

    for (let index = 0; index < mesh.quad_count; index += 1) {
      const word = mesh.quads[index * 2]!
      const origin = [word & 0x3f, (word >>> 6) & 0x3f, (word >>> 12) & 0x3f]
      const width = ((word >>> 18) & 0x1f) + 1
      const height = ((word >>> 23) & 0x1f) + 1
      const face = (word >>> 28) & 0x7
      const axis = face >>> 1
      for (let v = 0; v < height; v += 1)
        for (let u = 0; u < width; u += 1) {
          const position = [...origin]
          if (axis === 0) {
            position[1]! += u
            position[2]! += v
          } else if (axis === 1) {
            position[0]! += u
            position[2]! += v
          } else {
            position[0]! += u
            position[1]! += v
          }
          const key = [...position, face].join(':')
          actual.set(key, (actual.get(key) ?? 0) + 1)
        }
    }

    expect(new Set(actual.keys())).toEqual(expected)
    expect([...actual.values()].every((count) => count === 1)).toBeTrue()
  })
})
