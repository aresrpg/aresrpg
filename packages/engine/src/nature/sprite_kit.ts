// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The sprite kit — shared machinery every nature sprite builds on. Art direction (owner
// 2026-08-19): pixel art in a voxel world. Plants are CROSSED PIXEL-PLANES: 2D silhouettes drawn
// cell by cell on a coarse grid (stepped edges, three quantized color bands — the classic
// voxel-game cross sprite as geometry, no textures). Minerals are stacked axis-aligned boxes.
// One file per sprite lives beside this kit; scatter_layer.ts assembles them into kind pools.

/** x, y, z, accent blend (0 = body color, 1 = accent), wind sway weight. */
export type RecipeVertex = readonly [number, number, number, number, number]
/** One filled pixel: integer column (0 = centered), integer row, color band 0|1|2. */
export type PixelCell = readonly [number, number, number]
export type SpriteBuilder = (random: () => number) => readonly RecipeVertex[]

/** World size of one pixel cell — the whole art style hangs on this being chunky. */
export const CELL = 0.14
/** Band → accent blend: dark rooted base, mid body, bright accent. Three flat steps, no ramp. */
const BAND_BLEND = [0, 0.55, 1] as const

/** Tiny deterministic RNG — sprite variants are pure data baked once at module load. */
export const mulberry = (seed: number): (() => number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000
  }
}

export const randint = (random: () => number, low: number, high: number): number =>
  low + Math.floor(random() * (high - low + 1))

export const quad = (a: RecipeVertex, b: RecipeVertex, c: RecipeVertex, d: RecipeVertex): readonly RecipeVertex[] => [
  a,
  b,
  c,
  a,
  c,
  d,
]

export const rotate_y = ([x, y, z, blend, sway]: RecipeVertex, yaw: number): RecipeVertex => {
  const cos_yaw = Math.cos(yaw)
  const sin_yaw = Math.sin(yaw)
  return [x * cos_yaw + z * sin_yaw, y, z * cos_yaw - x * sin_yaw, blend, sway]
}

const merge_cells = (cells: readonly PixelCell[]): ReadonlyMap<string, number> => {
  const merged = new Map<string, number>()
  cells.forEach(([x, y, band]) => {
    const key = `${x}:${y}`
    merged.set(key, Math.max(merged.get(key) ?? 0, band))
  })
  return merged
}

/** Bake one vertical plane of pixel art: vertical runs of same-band cells merge into single
 * quads (fewer triangles, same stepped silhouette). Sway grows with height so bases stay rooted. */
const pixel_plane = (cells: readonly PixelCell[]): readonly RecipeVertex[] => {
  const merged = merge_cells(cells)
  const height_rows = Math.max(...[...merged.keys()].map((key) => Number(key.split(':')[1]))) + 1
  const columns = new Map<number, readonly (readonly [number, number])[]>()
  merged.forEach((band, key) => {
    const [x, y] = key.split(':').map(Number) as [number, number]
    columns.set(x, [...(columns.get(x) ?? []), [y, band] as const])
  })
  const vertices: RecipeVertex[] = []
  columns.forEach((rows, x) => {
    const sorted = [...rows].sort(([a], [b]) => a - b)
    let run_start = -1
    let run_band = -1
    let previous = -2
    const flush = (end_row: number): void => {
      if (run_start < 0) return
      const x0 = (x - 0.5) * CELL
      const x1 = (x + 0.5) * CELL
      const y0 = run_start * CELL
      const y1 = (end_row + 1) * CELL
      const blend = BAND_BLEND[run_band]!
      const sway_low = (run_start / height_rows) ** 2
      const sway_high = ((end_row + 1) / height_rows) ** 2
      vertices.push(
        ...quad(
          [x0, y0, 0, blend, sway_low],
          [x1, y0, 0, blend, sway_low],
          [x1, y1, 0, blend, sway_high],
          [x0, y1, 0, blend, sway_high]
        )
      )
    }
    sorted.forEach(([y, band]) => {
      if (y === previous + 1 && band === run_band) {
        previous = y
        return
      }
      flush(previous)
      run_start = y
      run_band = band
      previous = y
    })
    flush(previous)
  })
  return vertices
}

/** The voxel-game cross: the same pixel art on two perpendicular vertical planes. */
export const pixel_cross = (cells: readonly PixelCell[]): readonly RecipeVertex[] => {
  const plane = pixel_plane(cells)
  return [...plane, ...plane.map((vertex) => rotate_y(vertex, Math.PI / 2))]
}

/** Axis-aligned box, bottom face skipped (it sits on or in the ground). */
export const box = (
  center_x: number,
  base_y: number,
  center_z: number,
  half_w: number,
  height: number,
  half_d: number,
  blend: number
): readonly RecipeVertex[] => {
  const x0 = center_x - half_w
  const x1 = center_x + half_w
  const y0 = base_y
  const y1 = base_y + height
  const z0 = center_z - half_d
  const z1 = center_z + half_d
  return [
    ...quad([x0, y1, z0, blend, 0], [x1, y1, z0, blend, 0], [x1, y1, z1, blend, 0], [x0, y1, z1, blend, 0]),
    ...quad([x0, y0, z1, blend, 0], [x1, y0, z1, blend, 0], [x1, y1, z1, blend, 0], [x0, y1, z1, blend, 0]),
    ...quad([x1, y0, z0, blend, 0], [x0, y0, z0, blend, 0], [x0, y1, z0, blend, 0], [x1, y1, z0, blend, 0]),
    ...quad([x1, y0, z1, blend, 0], [x1, y0, z0, blend, 0], [x1, y1, z0, blend, 0], [x1, y1, z1, blend, 0]),
    ...quad([x0, y0, z0, blend, 0], [x0, y0, z1, blend, 0], [x0, y1, z1, blend, 0], [x0, y1, z0, blend, 0]),
  ]
}
