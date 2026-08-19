// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { BufferAttribute, BufferGeometry, Color } from 'three'

export type PreviewStructureVoxel = Readonly<{ local_x: number; y: number; local_z: number; color: string }>

type Rgb = readonly [number, number, number]

const add_quad = (
  positions: number[],
  colors: number[],
  indices: number[],
  points: readonly (readonly [number, number, number])[],
  color: Rgb
): void => {
  const vertex = positions.length / 3
  points.forEach((point) => {
    positions.push(...point)
    colors.push(...color)
  })
  indices.push(vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3)
}

export const preview_structure_geometry = (voxels: readonly PreviewStructureVoxel[]): BufferGeometry => {
  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  const palette = new Map<string, Rgb>()
  const color_for = (hex: string, light: number): Rgb => {
    const base =
      palette.get(hex) ??
      (() => {
        const parsed_color = new Color(hex)
        const parsed = [parsed_color.r, parsed_color.g, parsed_color.b] as const
        palette.set(hex, parsed)
        return parsed
      })()
    return [base[0] * light, base[1] * light, base[2] * light]
  }
  const unique = [
    ...new Map(voxels.map((voxel) => [`${voxel.local_x}:${voxel.y}:${voxel.local_z}`, voxel] as const)).values(),
  ]
  const keys = new Set(unique.map(({ local_x, y, local_z }) => `${local_x}:${y}:${local_z}`))
  const face = (
    voxel: PreviewStructureVoxel,
    neighbour: readonly [number, number, number],
    points: readonly (readonly [number, number, number])[],
    light: number
  ): void => {
    const [dx, dy, dz] = neighbour
    if (keys.has(`${voxel.local_x + dx}:${voxel.y + dy}:${voxel.local_z + dz}`)) return
    add_quad(positions, colors, indices, points, color_for(voxel.color, light))
  }
  unique.forEach((voxel) => {
    const x0 = voxel.local_x - 0.5
    const x1 = voxel.local_x + 0.5
    const y0 = voxel.y
    const y1 = voxel.y + 1
    const z0 = voxel.local_z - 0.5
    const z1 = voxel.local_z + 0.5
    face(
      voxel,
      [0, 1, 0],
      [
        [x0, y1, z0],
        [x0, y1, z1],
        [x1, y1, z1],
        [x1, y1, z0],
      ],
      1
    )
    face(
      voxel,
      [1, 0, 0],
      [
        [x1, y0, z0],
        [x1, y1, z0],
        [x1, y1, z1],
        [x1, y0, z1],
      ],
      0.7
    )
    face(
      voxel,
      [-1, 0, 0],
      [
        [x0, y0, z1],
        [x0, y1, z1],
        [x0, y1, z0],
        [x0, y0, z0],
      ],
      0.62
    )
    face(
      voxel,
      [0, 0, 1],
      [
        [x0, y0, z1],
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z1],
      ],
      0.78
    )
    face(
      voxel,
      [0, 0, -1],
      [
        [x1, y0, z0],
        [x0, y0, z0],
        [x0, y1, z0],
        [x1, y1, z0],
      ],
      0.58
    )
  })
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()
  return geometry
}
