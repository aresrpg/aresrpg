// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Restored tactical-board substrate: contiguous paving, deterministic wear, and darker side skirts.
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three'

export const BOARD_CELL_FLOOR = 0
export const BOARD_CELL_OBSTACLE = 1
export const BOARD_CELL_HOLE = 2
export const BOARD_CELL_VOID = 3
export const BOARD_FLOOR_THICKNESS = 0.3
// The board stands one block above its sampled ground. Keep the cavity inside that clearance so
// normal depth testing can compose it with terrain instead of cheating as a screen overlay.
export const BOARD_HOLE_DEPTH = 0.95

const TONE_LIGHT = [0xdd, 0xd4, 0xb6] as const
const TONE_MID = [0xcf, 0xc5, 0xa2] as const
const TONE_GRAY = [0xc6, 0xc0, 0xae] as const
const TUFT_GREENS = [
  [0x7a, 0xa0, 0x54],
  [0x5d, 0x87, 0x43],
] as const
const PX_PER_CELL = 64
const CHECKER_STRENGTH = 0.07

type BoardMask = Uint8Array
type BoardOrigin = Readonly<{ x: number; y: number; z: number }>

export const read_board_cell = (mask: BoardMask, x: number, y: number, width: number, height: number): number =>
  x < 0 || y < 0 || x >= width || y >= height ? BOARD_CELL_VOID : (mask[x + y * width] ?? BOARD_CELL_VOID)

const is_slab = (mask: BoardMask, width: number, height: number, x: number, y: number): boolean => {
  const cell = read_board_cell(mask, x, y, width, height)
  return cell === BOARD_CELL_FLOOR || cell === BOARD_CELL_OBSTACLE
}

const board_seed = (mask: BoardMask, width: number, height: number): number => {
  let hash = 0x811c9dc5
  const eat = (value: number): void => {
    hash ^= value & 0xff
    hash = Math.imul(hash, 0x01000193)
  }
  eat(width)
  eat(height)
  mask.forEach(eat)
  return hash >>> 0
}

const hash2 = (seed: number, x: number, y: number): number => {
  let hash = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2246822519)
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177)
  hash ^= hash >>> 16
  return (hash >>> 0) / 4294967296
}

const patch_noise = (seed: number, fx: number, fy: number): number => {
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const tx = fx - x0
  const ty = fy - y0
  const sx = tx * tx * (3 - 2 * tx)
  const sy = ty * ty * (3 - 2 * ty)
  const a = hash2(seed, x0, y0)
  const b = hash2(seed, x0 + 1, y0)
  const c = hash2(seed, x0, y0 + 1)
  const d = hash2(seed, x0 + 1, y0 + 1)
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
}

/* eslint-disable complexity -- this is the restored linear procedural texture bake. */
export const bake_fight_board_surface = (mask: BoardMask, width: number, height: number): DataTexture => {
  const seed = board_seed(mask, width, height)
  const px = Math.max(16, Math.min(PX_PER_CELL, Math.floor(2048 / Math.max(width, height))))
  const texture_width = width * px
  const texture_height = height * px
  const data = new Uint8Array(texture_width * texture_height * 4)
  const slab_at = (x: number, y: number): boolean => is_slab(mask, width, height, x, y)

  for (let y = 0; y < texture_height; y += 1) {
    const cell_y = Math.floor(y / px)
    const local_y = y - cell_y * px
    for (let x = 0; x < texture_width; x += 1) {
      const cell_x = Math.floor(x / px)
      const local_x = x - cell_x * px
      const pick = hash2(seed, cell_x, cell_y)
      const base = pick < 0.5 ? TONE_LIGHT : pick < 0.82 ? TONE_MID : TONE_GRAY
      const patch = 0.92 + patch_noise(seed ^ 0x9e37, cell_x * 0.35 + x / (px * 6), cell_y * 0.35 + y / (px * 6)) * 0.14
      const grain = 0.985 + hash2(seed ^ 0x51ed, x, y) * 0.03
      let multiplier = patch * grain * ((cell_x + cell_y) % 2 === 0 ? 1 + CHECKER_STRENGTH : 1 - CHECKER_STRENGTH)
      const seam_px = 2
      const near_seam = local_x < seam_px || local_y < seam_px || local_x >= px - seam_px || local_y >= px - seam_px
      const bevel =
        !near_seam &&
        (local_x === seam_px || local_y === seam_px || local_x === px - seam_px - 1 || local_y === px - seam_px - 1)
      if (near_seam)
        multiplier *=
          0.72 * (0.94 + hash2(seed ^ 0x7f4a, cell_x + (local_x < 1 ? -1 : 0), cell_y + (local_y < 1 ? -1 : 0)) * 0.12)
      else if (bevel) multiplier *= 1.05
      const rim =
        (local_x < 4 && !slab_at(cell_x - 1, cell_y)) ||
        (local_y < 4 && !slab_at(cell_x, cell_y - 1)) ||
        (local_x >= px - 4 && !slab_at(cell_x + 1, cell_y)) ||
        (local_y >= px - 4 && !slab_at(cell_x, cell_y + 1))
      if (rim) multiplier *= 0.6
      const offset = (x + y * texture_width) * 4
      data[offset] = Math.min(255, base[0] * multiplier)
      data[offset + 1] = Math.min(255, base[1] * multiplier)
      data[offset + 2] = Math.min(255, base[2] * multiplier)
      data[offset + 3] = 255
    }
  }

  const stain = (x: number, y: number, multiplier: number): void => {
    if (x < 0 || y < 0 || x >= texture_width || y >= texture_height) return
    const offset = (x + y * texture_width) * 4
    data[offset] = (data[offset] ?? 0) * multiplier
    data[offset + 1] = (data[offset + 1] ?? 0) * multiplier
    data[offset + 2] = (data[offset + 2] ?? 0) * multiplier
  }

  for (let cell_y = 0; cell_y < height; cell_y += 1)
    for (let cell_x = 0; cell_x < width; cell_x += 1) {
      if (!slab_at(cell_x, cell_y) || hash2(seed ^ 0xc4ac, cell_x, cell_y) >= 0.1) continue
      let vertex_x = cell_x * px + 4 + Math.floor(hash2(seed ^ 0x11, cell_x, cell_y) * (px - 8))
      let vertex_y = cell_y * px + 2
      let direction = hash2(seed ^ 0x22, cell_x, cell_y) * 0.8 - 0.4
      const length = px * (0.4 + hash2(seed ^ 0x33, cell_x, cell_y) * 0.5)
      for (let step = 0; step < length; step += 1) {
        stain(vertex_x, vertex_y, 0.78)
        stain(vertex_x + 1, vertex_y, 0.96)
        direction += (hash2(seed ^ 0x44, vertex_x, vertex_y) - 0.5) * 0.5
        vertex_x += Math.round(direction)
        vertex_y += 1
      }
    }

  const slab_cells: [number, number][] = []
  for (let cell_y = 0; cell_y < height; cell_y += 1)
    for (let cell_x = 0; cell_x < width; cell_x += 1) if (slab_at(cell_x, cell_y)) slab_cells.push([cell_x, cell_y])
  const start = slab_cells[Math.floor(hash2(seed ^ 0x55, 1, 1) * slab_cells.length)]
  if (slab_cells.length > 4 && start) {
    let end = start
    slab_cells.forEach((candidate) => {
      if (
        Math.hypot(candidate[0] - start[0], candidate[1] - start[1]) > Math.hypot(end[0] - start[0], end[1] - start[1])
      )
        end = candidate
    })
    const start_x = (start[0] + 0.5) * px
    const start_y = (start[1] + 0.5) * px
    const steps = Math.floor(Math.hypot((end[0] - start[0]) * px, (end[1] - start[1]) * px) / (px * 0.3))
    const dx = ((end[0] - start[0]) * px) / Math.max(1, steps)
    const dy = ((end[1] - start[1]) * px) / Math.max(1, steps)
    const distance = Math.hypot(dx, dy)
    const normal_x = -dy / distance
    const normal_y = dx / distance
    for (let step = 0; step < steps; step += 1) {
      const side = step % 2 === 0 ? 3 : -3
      const foot_x = Math.round(start_x + dx * step + normal_x * side + (hash2(seed ^ 0x66, step, 0) - 0.5) * 3)
      const foot_y = Math.round(start_y + dy * step + normal_y * side + (hash2(seed ^ 0x77, step, 1) - 0.5) * 3)
      if (!slab_at(Math.floor(foot_x / px), Math.floor(foot_y / px))) continue
      for (let oy = -2; oy <= 3; oy += 1) for (let ox = -2; ox <= 2; ox += 1) stain(foot_x + ox, foot_y + oy, 0.84)
    }
  }

  for (let cell_y = 1; cell_y < height; cell_y += 1)
    for (let cell_x = 1; cell_x < width; cell_x += 1) {
      if (
        !(
          slab_at(cell_x, cell_y) &&
          slab_at(cell_x - 1, cell_y) &&
          slab_at(cell_x, cell_y - 1) &&
          slab_at(cell_x - 1, cell_y - 1)
        ) ||
        hash2(seed ^ 0x88, cell_x, cell_y) >= 0.05
      )
        continue
      const grass_x = cell_x * px
      const grass_y = cell_y * px
      for (let blade = 0; blade < 5; blade += 1) {
        const color = TUFT_GREENS[blade % 2] ?? TUFT_GREENS[0]
        const [red, green, blue] = color
        const blade_x = grass_x + Math.floor((hash2(seed ^ 0x99, cell_x * 8 + blade, cell_y) - 0.5) * 8)
        const blade_height = 2 + Math.floor(hash2(seed ^ 0xaa, blade, cell_y) * 3)
        for (let step = 0; step < blade_height; step += 1) {
          const offset =
            (Math.max(0, Math.min(texture_width - 1, blade_x)) +
              Math.max(0, Math.min(texture_height - 1, grass_y - step)) * texture_width) *
            4
          data[offset] = red
          data[offset + 1] = green
          data[offset + 2] = blue
        }
      }
    }

  const texture = new DataTexture(data, texture_width, texture_height)
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
/* eslint-enable complexity */

export const build_fight_board_slab = (
  mask: BoardMask,
  width: number,
  height: number,
  cell_size: number,
  origin: BoardOrigin
): BufferGeometry => {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const top_indices: number[] = []
  const side_indices: number[] = []
  const top_y = origin.y + BOARD_FLOOR_THICKNESS
  const bottom_y = origin.y - 0.35
  const vertex = (
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    u: number,
    v: number
  ): number => {
    positions.push(x, y, z)
    normals.push(nx, ny, nz)
    uvs.push(u, v)
    return positions.length / 3 - 1
  }
  const quad = (target: number[], a: number, b: number, c: number, d: number): void => {
    target.push(a, b, c, a, c, d)
  }

  for (let cell_y = 0; cell_y < height; cell_y += 1)
    for (let cell_x = 0; cell_x < width; cell_x += 1) {
      if (!is_slab(mask, width, height, cell_x, cell_y)) continue
      const x0 = origin.x + cell_x * cell_size
      const x1 = x0 + cell_size
      const z0 = origin.z + cell_y * cell_size
      const z1 = z0 + cell_size
      const a = vertex(x0, top_y, z0, 0, 1, 0, cell_x / width, cell_y / height)
      const b = vertex(x1, top_y, z0, 0, 1, 0, (cell_x + 1) / width, cell_y / height)
      const c = vertex(x1, top_y, z1, 0, 1, 0, (cell_x + 1) / width, (cell_y + 1) / height)
      const d = vertex(x0, top_y, z1, 0, 1, 0, cell_x / width, (cell_y + 1) / height)
      quad(top_indices, a, d, c, b)
      const edges = [
        [cell_x, cell_y - 1, x0, z0, x1, z0, 0, -1],
        [cell_x + 1, cell_y, x1, z0, x1, z1, 1, 0],
        [cell_x, cell_y + 1, x1, z1, x0, z1, 0, 1],
        [cell_x - 1, cell_y, x0, z1, x0, z0, -1, 0],
      ] as const
      edges.forEach(([next_x, next_y, edge_x0, edge_z0, edge_x1, edge_z1, normal_x, normal_z]) => {
        const neighbour = read_board_cell(mask, next_x, next_y, width, height)
        if (is_slab(mask, width, height, next_x, next_y) || neighbour === BOARD_CELL_HOLE) return
        const edge_a = vertex(edge_x0, top_y, edge_z0, normal_x, 0, normal_z, 0, 0)
        const edge_b = vertex(edge_x1, top_y, edge_z1, normal_x, 0, normal_z, 0, 0)
        const edge_c = vertex(edge_x1, bottom_y, edge_z1, normal_x, 0, normal_z, 0, 0)
        const edge_d = vertex(edge_x0, bottom_y, edge_z0, normal_x, 0, normal_z, 0, 0)
        quad(side_indices, edge_a, edge_b, edge_c, edge_d)
      })
    }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
  geometry.setIndex([...top_indices, ...side_indices])
  geometry.addGroup(0, top_indices.length, 0)
  geometry.addGroup(top_indices.length, side_indices.length, 1)
  return geometry
}

export const build_fight_board_pits = (
  mask: BoardMask,
  width: number,
  height: number,
  cell_size: number,
  origin: BoardOrigin
): BufferGeometry => {
  const positions: number[] = []
  const normals: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  const top_y = origin.y + BOARD_FLOOR_THICKNESS
  const bottom_y = top_y - BOARD_HOLE_DEPTH
  const top_color = new Color(0x2c2d31)
  const bottom_color = new Color(0x040506)
  const vertex = (x: number, y: number, z: number, nx: number, ny: number, nz: number): number => {
    const color = y === top_y ? top_color : bottom_color
    positions.push(x, y, z)
    normals.push(nx, ny, nz)
    colors.push(color.r, color.g, color.b)
    return positions.length / 3 - 1
  }
  const quad = (a: number, b: number, c: number, d: number): void => {
    indices.push(a, b, c, a, c, d)
  }
  const hole_at = (x: number, y: number): boolean => read_board_cell(mask, x, y, width, height) === BOARD_CELL_HOLE

  for (let cell_y = 0; cell_y < height; cell_y += 1)
    for (let cell_x = 0; cell_x < width; cell_x += 1) {
      if (!hole_at(cell_x, cell_y)) continue
      const x0 = origin.x + cell_x * cell_size
      const x1 = x0 + cell_size
      const z0 = origin.z + cell_y * cell_size
      const z1 = z0 + cell_size
      quad(
        vertex(x0, bottom_y, z0, 0, 1, 0),
        vertex(x0, bottom_y, z1, 0, 1, 0),
        vertex(x1, bottom_y, z1, 0, 1, 0),
        vertex(x1, bottom_y, z0, 0, 1, 0)
      )
      const edges = [
        [cell_x, cell_y - 1, x0, z0, x1, z0, 0, 1],
        [cell_x + 1, cell_y, x1, z0, x1, z1, -1, 0],
        [cell_x, cell_y + 1, x1, z1, x0, z1, 0, -1],
        [cell_x - 1, cell_y, x0, z1, x0, z0, 1, 0],
      ] as const
      edges.forEach(([next_x, next_y, edge_x0, edge_z0, edge_x1, edge_z1, normal_x, normal_z]) => {
        if (hole_at(next_x, next_y)) return
        quad(
          vertex(edge_x0, top_y, edge_z0, normal_x, 0, normal_z),
          vertex(edge_x0, bottom_y, edge_z0, normal_x, 0, normal_z),
          vertex(edge_x1, bottom_y, edge_z1, normal_x, 0, normal_z),
          vertex(edge_x1, top_y, edge_z1, normal_x, 0, normal_z)
        )
      })
    }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3))
  geometry.setIndex(indices)
  return geometry
}
