// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { CompiledStructureType } from '../structures.ts'
import type { CompiledMaterials } from '../world_materials.ts'

export type CityBlock = readonly [x: number, y: number, z: number, material: string]
export type CityStructureSource = Readonly<{
  name: string
  size: readonly [number, number, number]
  anchor: readonly [number, number, number]
  blocks: readonly CityBlock[]
}>
export type PositionedCityStructure = Readonly<{
  type: CompiledStructureType
  x: number
  y: number
  z: number
}>

export type CityBlockBuilder = Readonly<{
  set: (x: number, y: number, z: number, material: string) => void
  fill: (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, material: string) => void
  walls: (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, material: string) => void
  clear: (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => void
  finish: () => readonly CityBlock[]
}>

export const city_blocks = (): CityBlockBuilder => {
  const blocks = new Map<string, CityBlock>()
  const set = (x: number, y: number, z: number, material: string): void => {
    blocks.set(`${x}:${y}:${z}`, Object.freeze([x, y, z, material]))
  }
  const volume = (
    x0: number,
    x1: number,
    y0: number,
    y1: number,
    z0: number,
    z1: number,
    visit: (x: number, y: number, z: number) => void
  ): void => {
    for (let y = y0; y <= y1; y += 1) for (let z = z0; z <= z1; z += 1) for (let x = x0; x <= x1; x += 1) visit(x, y, z)
  }
  return Object.freeze({
    set,
    fill: (x0, x1, y0, y1, z0, z1, material) => volume(x0, x1, y0, y1, z0, z1, (x, y, z) => set(x, y, z, material)),
    walls: (x0, x1, y0, y1, z0, z1, material) =>
      volume(x0, x1, y0, y1, z0, z1, (x, y, z) => {
        if (x === x0 || x === x1 || z === z0 || z === z1) set(x, y, z, material)
      }),
    clear: (x0, x1, y0, y1, z0, z1) => volume(x0, x1, y0, y1, z0, z1, (x, y, z) => blocks.delete(`${x}:${y}:${z}`)),
    finish: () => Object.freeze([...blocks.values()]),
  })
}

export const compile_city_structure = (
  source: CityStructureSource,
  materials: CompiledMaterials
): CompiledStructureType => {
  const [width, height, length] = source.size
  const ordered = [...source.blocks].sort(([ax, ay, az], [bx, by, bz]) => ay - by || az - bz || ax - bx)
  const y_counts = new Uint32Array(height)
  const packed_voxels = ordered.map(([x, y, z, material]) => {
    if (x < 0 || x >= width || y < 0 || y >= height || z < 0 || z >= length)
      throw new TypeError(`${source.name} block ${x},${y},${z} leaves ${width}x${height}x${length}`)
    y_counts[y] += 1
    const material_id = material === 'air' ? 0 : materials.id_for(material)
    return ((material_id & 0xff) << 24) | ((y & 0xff) << 16) | ((z & 0xff) << 8) | (x & 0xff)
  })
  const y_offsets = new Uint32Array(height + 1)
  y_counts.forEach((count, y) => {
    y_offsets[y + 1] = y_offsets[y]! + count
  })
  return Object.freeze({
    name: source.name,
    size: source.size,
    anchor: source.anchor,
    packed_voxels: new Uint32Array(packed_voxels),
    y_offsets,
    footprint: Math.max(width, length),
  })
}

export const compile_positioned_city_structure = (
  name: string,
  blocks: readonly CityBlock[],
  materials: CompiledMaterials
): PositionedCityStructure => {
  if (blocks.length === 0) throw new TypeError(`${name} has no blocks`)
  const x = Math.min(...blocks.map(([block_x]) => block_x))
  const y = Math.min(...blocks.map(([, block_y]) => block_y))
  const z = Math.min(...blocks.map(([, , block_z]) => block_z))
  const max_x = Math.max(...blocks.map(([block_x]) => block_x))
  const max_y = Math.max(...blocks.map(([, block_y]) => block_y))
  const max_z = Math.max(...blocks.map(([, , block_z]) => block_z))
  const source = Object.freeze({
    name,
    size: [max_x - x + 1, max_y - y + 1, max_z - z + 1] as const,
    anchor: [0, 0, 0] as const,
    blocks: Object.freeze(
      blocks.map(([block_x, block_y, block_z, material]) => [block_x - x, block_y - y, block_z - z, material] as const)
    ),
  })
  return Object.freeze({ type: compile_city_structure(source, materials), x, y, z })
}
