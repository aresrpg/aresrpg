// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { partition_detail_triangle, type DetailVertex as Vertex } from './detail_partition.ts'
import { DETAIL_STRIDE, type DetailCell } from './detail_artifact.ts'
import { CHUNK_EDGE } from './voxel_data.ts'
import type { Vec3 } from './types.ts'

const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const unit = (v: Vec3): Vec3 => {
  const length = Math.hypot(...v)
  if (length < 1e-8) throw new TypeError('Detail geometry cannot have a zero-length axis')
  return [v[0] / length, v[1] / length, v[2] / length]
}
const encode = (vertices: readonly Vertex[], origin: Vec3, palette: readonly string[]): string => {
  const bytes = new Uint8Array(vertices.length * DETAIL_STRIDE * 4)
  const view = new DataView(bytes.buffer)
  vertices.forEach((vertex, index) => {
    const row = [...subtract(vertex.position, origin), ...vertex.normal, ...vertex.uv, palette.indexOf(vertex.material)]
    row.forEach((value, component) => view.setFloat32((index * DETAIL_STRIDE + component) * 4, value, true))
  })
  let binary = ''
  for (let index = 0; index < bytes.length; index += 8192)
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192))
  return btoa(binary)
}

/** Offline geometry construction. No Three.js, world state, runtime triangulation or prop-specific renderer. */
const detail_writer = (triangles: Vertex[][], transform: (point: Vec3) => Vec3, mirrored = false) => {
  const quad = (
    a: Vec3,
    b: Vec3,
    c: Vec3,
    d: Vec3,
    material: string,
    texture_coordinates?: readonly (readonly [number, number])[]
  ): void => {
    const points = [a, b, c, d].map(transform)
    if (mirrored) points.reverse()
    const normal = unit(cross(subtract(points[1]!, points[0]!), subtract(points[2]!, points[0]!)))
    const width = Math.hypot(...subtract(b, a)) / 4
    const height = Math.hypot(...subtract(d, a)) / 4
    const vertices = points.map((position, index) => ({
      position,
      normal,
      material,
      uv:
        texture_coordinates?.[mirrored ? 3 - index : index] ??
        (
          [
            [0, 0],
            [width, 0],
            [width, height],
            [0, height],
          ] as const
        )[mirrored ? 3 - index : index]!,
    }))
    triangles.push([vertices[0]!, vertices[1]!, vertices[2]!], [vertices[0]!, vertices[2]!, vertices[3]!])
  }
  const beam = (start: Vec3, end: Vec3, width: number, depth: number, material: string): void => {
    if (!(width > 0 && depth > 0)) throw new TypeError('Detail beam dimensions must be positive')
    const axis = unit(subtract(end, start))
    const right = unit(cross(axis, Math.abs(axis[1]) > 0.99 ? [0, 0, 1] : [0, 1, 0]))
    const up = cross(right, axis)
    const corner = (point: Vec3, x: number, y: number): Vec3 => [
      point[0] + (right[0] * x * width) / 2 + (up[0] * y * depth) / 2,
      point[1] + (right[1] * x * width) / 2 + (up[1] * y * depth) / 2,
      point[2] + (right[2] * x * width) / 2 + (up[2] * y * depth) / 2,
    ]
    const ring = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const
    const a = ring.map(([x, y]) => corner(start, x, y))
    const b = ring.map(([x, y]) => corner(end, x, y))
    for (let side = 0; side < 4; side++) {
      const next = (side + 1) % 4
      quad(a[side]!, b[side]!, b[next]!, a[next]!, material)
    }
    quad(a[0]!, a[1]!, a[2]!, a[3]!, material)
    quad(b[3]!, b[2]!, b[1]!, b[0]!, material)
  }
  return Object.freeze({
    quad,
    beam,
    box: (min: Vec3, max: Vec3, material: string): void => {
      const x = (min[0] + max[0]) / 2
      const z = (min[2] + max[2]) / 2
      beam([x, min[1], z], [x, max[1], z], max[0] - min[0], max[2] - min[2], material)
    },
    rope: (start: Vec3, end: Vec3, sag: number, radius: number, material: string): void => {
      const segments = Math.max(2, Math.ceil(Math.hypot(...subtract(end, start)) / 2))
      const point = (t: number): Vec3 => [
        start[0] + (end[0] - start[0]) * t,
        start[1] + (end[1] - start[1]) * t - Math.sin(Math.PI * t) * sag,
        start[2] + (end[2] - start[2]) * t,
      ]
      for (let index = 0; index < segments; index++)
        beam(point(index / segments), point((index + 1) / segments), radius * 2, radius * 2, material)
    },
  })
}

export const detail_builder = () => {
  const triangles: Vertex[][] = []
  return Object.freeze({
    ...detail_writer(triangles, (point) => point),
    transformed: (transform: (point: Vec3) => Vec3, mirrored = false) => detail_writer(triangles, transform, mirrored),
    finish: (): readonly DetailCell[] => {
      const cells = new Map<string, { origin: Vec3; vertices: Vertex[] }>()
      triangles.flatMap(partition_detail_triangle).forEach((triangle) => {
        const origin = [0, 1, 2].map(
          (axis) => Math.floor(triangle.reduce((sum, v) => sum + v.position[axis]!, 0) / 3 / CHUNK_EDGE) * CHUNK_EDGE
        ) as unknown as Vec3
        const key = origin.join(',')
        const cell = cells.get(key) ?? { origin, vertices: [] }
        cell.vertices.push(...triangle)
        cells.set(key, cell)
      })
      return [...cells.values()].map(({ origin, vertices }) => {
        const palette = [...new Set(vertices.map((vertex) => vertex.material))]
        return { origin, palette, vertices: encode(vertices, origin, palette) }
      })
    },
  })
}
