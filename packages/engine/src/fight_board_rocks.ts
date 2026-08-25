// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Seamless blocky stone for board obstacles. Every obstacle cell raises a full-cell plinth whose
// interior walls are skipped (adjacent cells share one continuous body), hewn stone chunks sit on
// top, and every shared edge carries a bridging chunk — the formation reads as ONE block of one
// color. Fully deterministic per cell coordinates, so the same board renders identically everywhere.

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/** the one stone color — the surface bake tints obstacle cells with it so tile and rock fuse */
export const STONE_COLOR = 0x82795c
/** plinth height as a fraction of the cell — the solid base the chunks grow from */
const PLINTH_RATIO = 0.18
/** corner wobble amplitude — enough to break perfection, small enough to stay blocky */
const WOBBLE = 0.07

export type RockCell = Readonly<{ x: number; y: number }>

const hash = (x: number, y: number, salt: number): number => {
  let value = (x | 0) * 374761393 + (y | 0) * 668265263 + (salt | 0) * 2246822519
  value = Math.imul(value ^ (value >>> 13), 1274126177)
  value ^= value >>> 16
  return (value >>> 0) / 4294967296
}

/** Continuous over local position — duplicated (non-indexed) vertices displace identically, so
 * faces never tear, and the computed normals stay faceted. */
const wobble_of = (px: number, py: number, pz: number, seed: number): number =>
  1 + Math.sin(px * 4.7 + seed * 31) * Math.sin(py * 3.9 + seed * 57) * Math.sin(pz * 5.3 + seed * 71) * WOBBLE

const tone = new Color(STONE_COLOR)

const paint = (geometry: BufferGeometry, top_y: number, base_y: number): void => {
  const positions = geometry.getAttribute('position')
  const colors = new Float32Array(positions.count * 3)
  for (let index = 0; index < positions.count; index += 1) {
    const height_frac = Math.min(1, Math.max(0, (positions.getY(index) - base_y) / Math.max(0.001, top_y - base_y)))
    // one color, lit by height: faces brighten toward the top like sun-worn stone
    const shade = 0.78 + 0.3 * height_frac
    colors[index * 3] = tone.r * shade
    colors[index * 3 + 1] = tone.g * shade
    colors[index * 3 + 2] = tone.b * shade
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
}

/** One hewn chunk: a box whose corners stray a little — blocky, never a boulder. */
const chunk = (seed: number, size_x: number, size_y: number, size_z: number): BufferGeometry => {
  const geometry = new BoxGeometry(size_x, size_y, size_z).toNonIndexed()
  geometry.deleteAttribute('normal')
  geometry.deleteAttribute('uv')
  const positions = geometry.getAttribute('position')
  for (let index = 0; index < positions.count; index += 1) {
    const px = positions.getX(index)
    const py = positions.getY(index)
    const pz = positions.getZ(index)
    const wobble = wobble_of(px / size_x, py / size_y, pz / size_z, seed)
    positions.setXYZ(index, px * wobble, py * wobble, pz * wobble)
  }
  return geometry
}

/** The formation's base: one extruded outline over all obstacle cells — interior walls between
 * adjacent cells are skipped, so neighbours share a single seamless body (and never z-fight). */
const plinth = (
  cells: readonly RockCell[],
  occupied: ReadonlySet<number>,
  cell_size: number,
  origin: Readonly<{ x: number; z: number }>,
  floor_y: number,
  top_y: number
): BufferGeometry => {
  const positions: number[] = []
  const push_quad = (a: readonly number[], b: readonly number[], c: readonly number[], d: readonly number[]): void => {
    positions.push(...a, ...b, ...c, ...a, ...c, ...d)
  }
  cells.forEach(({ x, y }) => {
    const x0 = origin.x + x * cell_size
    const x1 = x0 + cell_size
    const z0 = origin.z + y * cell_size
    const z1 = z0 + cell_size
    push_quad([x0, top_y, z0], [x0, top_y, z1], [x1, top_y, z1], [x1, top_y, z0])
    const edges = [
      [x, y - 1, x0, z0, x1, z0],
      [x + 1, y, x1, z0, x1, z1],
      [x, y + 1, x1, z1, x0, z1],
      [x - 1, y, x0, z1, x0, z0],
    ] as const
    edges.forEach(([next_x, next_y, edge_x0, edge_z0, edge_x1, edge_z1]) => {
      if (occupied.has(next_x * 4096 + next_y)) return
      push_quad(
        [edge_x0, top_y, edge_z0],
        [edge_x0, floor_y, edge_z0],
        [edge_x1, floor_y, edge_z1],
        [edge_x1, top_y, edge_z1]
      )
    })
  })
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  return geometry
}

/** One merged, vertex-colored stone formation for the whole obstacle set — a single draw call.
 * `floor_y` is the slab's top surface. */
export const build_obstacle_rocks = ({
  cells,
  cell_size,
  origin,
  floor_y,
}: Readonly<{
  cells: readonly RockCell[]
  cell_size: number
  origin: Readonly<{ x: number; z: number }>
  floor_y: number
}>): BufferGeometry => {
  if (cells.length === 0) return new BufferGeometry()
  const occupied = new Set(cells.map(({ x, y }) => x * 4096 + y))
  const plinth_top = floor_y + cell_size * PLINTH_RATIO
  const parts: BufferGeometry[] = [plinth(cells, occupied, cell_size, origin, floor_y - 0.05, plinth_top)]
  const add = (
    x: number,
    y: number,
    salt: number,
    world_x: number,
    world_z: number,
    width: number,
    height: number
  ): void => {
    const rock = chunk(hash(x, y, salt + 11) * 100, width, height, width * (0.85 + hash(x, y, salt + 5) * 0.3))
    rock.rotateY((hash(x, y, salt + 13) - 0.5) * 0.5)
    rock.translate(world_x, plinth_top + height * 0.4, world_z)
    const positions = rock.getAttribute('position')
    for (let index = 0; index < positions.count; index += 1)
      positions.setY(index, Math.max(positions.getY(index), floor_y))
    parts.push(rock)
  }
  cells.forEach(({ x, y }) => {
    const center_x = origin.x + (x + 0.5) * cell_size
    const center_z = origin.z + (y + 0.5) * cell_size
    const jitter = (salt: number): number => (hash(x, y, salt) - 0.5) * cell_size * 0.14
    // the cell's main block, and a lower shoulder beside it
    add(
      x,
      y,
      0,
      center_x + jitter(1),
      center_z + jitter(2),
      cell_size * (0.5 + hash(x, y, 3) * 0.14),
      cell_size * (0.34 + hash(x, y, 4) * 0.16)
    )
    const angle = hash(x, y, 20) * Math.PI * 2
    add(
      x,
      y,
      40,
      center_x + Math.cos(angle) * cell_size * 0.26,
      center_z + Math.sin(angle) * cell_size * 0.26,
      cell_size * (0.28 + hash(x, y, 50) * 0.1),
      cell_size * (0.18 + hash(x, y, 60) * 0.1)
    )
    // a bridging chunk on every shared edge fuses the silhouettes above the shared plinth
    if (occupied.has((x + 1) * 4096 + y))
      add(
        x,
        y,
        70,
        center_x + cell_size * 0.5,
        center_z + jitter(71),
        cell_size * (0.3 + hash(x, y, 72) * 0.1),
        cell_size * (0.22 + hash(x, y, 73) * 0.12)
      )
    if (occupied.has(x * 4096 + y + 1))
      add(
        x,
        y,
        80,
        center_x + jitter(81),
        center_z + cell_size * 0.5,
        cell_size * (0.3 + hash(x, y, 82) * 0.1),
        cell_size * (0.22 + hash(x, y, 83) * 0.12)
      )
  })
  const merged = mergeGeometries(parts)
  parts.forEach((part) => part.dispose())
  const top = plinth_top + cell_size * 0.6
  paint(merged, top, floor_y)
  merged.computeVertexNormals()
  project_box_uvs(merged)
  return merged
}

/** Box-projected UVs: each face samples the stone map along its two non-dominant world axes, so
 * the texture wraps every chunk and the plinth without an unwrap. Runs after normals exist. */
const project_box_uvs = (geometry: BufferGeometry): void => {
  const positions = geometry.getAttribute('position')
  if (!positions) return
  const normals = geometry.getAttribute('normal')
  const uvs = new Float32Array(positions.count * 2)
  const scale = 0.55
  for (let index = 0; index < positions.count; index += 1) {
    const nx = Math.abs(normals.getX(index))
    const ny = Math.abs(normals.getY(index))
    const nz = Math.abs(normals.getZ(index))
    const px = positions.getX(index)
    const py = positions.getY(index)
    const pz = positions.getZ(index)
    if (ny >= nx && ny >= nz) {
      uvs[index * 2] = px * scale
      uvs[index * 2 + 1] = pz * scale
    } else if (nx >= nz) {
      uvs[index * 2] = pz * scale
      uvs[index * 2 + 1] = py * scale
    } else {
      uvs[index * 2] = px * scale
      uvs[index * 2 + 1] = py * scale
    }
  }
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2))
}

/** Tileable grayscale stone detail — pits, speckle, and hairline cracks. The mesh's vertex tone
 * multiplies it, so the map carries only relief, never hue. */
export const bake_stone_texture = (): DataTexture => {
  const size = 128
  const data = new Uint8Array(size * size * 4)
  const value_at = (x: number, y: number, salt: number): number => hash((x + size) % size, (y + size) % size, salt)
  const smooth = (fx: number, fy: number, salt: number): number => {
    const x0 = Math.floor(fx)
    const y0 = Math.floor(fy)
    const tx = fx - x0
    const ty = fy - y0
    const sx = tx * tx * (3 - 2 * tx)
    const sy = ty * ty * (3 - 2 * ty)
    const a = value_at(x0, y0, salt)
    const b = value_at(x0 + 1, y0, salt)
    const c = value_at(x0, y0 + 1, salt)
    const d = value_at(x0 + 1, y0 + 1, salt)
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
  }
  for (let y = 0; y < size; y += 1)
    for (let x = 0; x < size; x += 1) {
      // broad mineral patches, then fine speckle
      const patch = 0.88 + smooth(x / 17, y / 17, 5) * 0.18 + smooth(x / 6, y / 6, 9) * 0.08
      const speckle = value_at(x, y, 13) < 0.06 ? 0.82 : 1
      const level = Math.min(255, 236 * patch * speckle)
      const offset = (x + y * size) * 4
      data[offset] = level
      data[offset + 1] = level
      data[offset + 2] = level
      data[offset + 3] = 255
    }
  // hairline cracks: darker wandering walks, wrapped so the tile stays seamless
  for (let crack = 0; crack < 7; crack += 1) {
    let x = Math.floor(hash(crack, 1, 21) * size)
    let y = Math.floor(hash(crack, 2, 22) * size)
    let direction = hash(crack, 3, 23) * Math.PI * 2
    const steps = 40 + Math.floor(hash(crack, 4, 24) * 50)
    for (let step = 0; step < steps; step += 1) {
      const offset = (((x + size) % size) + ((y + size) % size) * size) * 4
      data[offset] = (data[offset] ?? 0) * 0.62
      data[offset + 1] = (data[offset + 1] ?? 0) * 0.62
      data[offset + 2] = (data[offset + 2] ?? 0) * 0.62
      direction += (hash(x, y, 25 + crack) - 0.5) * 0.9
      x += Math.round(Math.cos(direction))
      y += Math.round(Math.sin(direction))
    }
  }
  const texture = new DataTexture(data, size, size)
  texture.colorSpace = SRGBColorSpace
  texture.magFilter = LinearFilter
  texture.minFilter = LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.anisotropy = 8
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.needsUpdate = true
  return texture
}
