// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One world-aligned water surface: block-scale sampling near the player, coarse sampling at distance.
// Both the renderer and worker consume this layout, so the sampled bed can never end before the mesh.

export type WaterSurfaceLayout = Readonly<{
  positions: Float32Array
  indices: Uint32Array
}>

const INNER_RADIUS = 256
const INNER_STEP = 4
const OUTER_RADIUS = 4_096
const OUTER_STEP = 64

export const create_water_surface_layout = (): WaterSurfaceLayout => {
  const positions: number[] = []
  const indices: number[] = []
  const add_grid = (min_x: number, max_x: number, min_z: number, max_z: number, step: number): void => {
    const columns = Math.round((max_x - min_x) / step) + 1
    const rows = Math.round((max_z - min_z) / step) + 1
    const first = positions.length / 3
    for (let z = 0; z < rows; z += 1)
      for (let x = 0; x < columns; x += 1) positions.push(min_x + x * step, 0, min_z + z * step)
    for (let z = 0; z < rows - 1; z += 1)
      for (let x = 0; x < columns - 1; x += 1) {
        const top_left = first + z * columns + x
        indices.push(
          top_left,
          top_left + 1,
          top_left + columns,
          top_left + columns,
          top_left + 1,
          top_left + columns + 1
        )
      }
  }

  add_grid(-INNER_RADIUS, INNER_RADIUS, -INNER_RADIUS, INNER_RADIUS, INNER_STEP)
  add_grid(-OUTER_RADIUS, OUTER_RADIUS, -OUTER_RADIUS, -INNER_RADIUS, OUTER_STEP)
  add_grid(-OUTER_RADIUS, OUTER_RADIUS, INNER_RADIUS, OUTER_RADIUS, OUTER_STEP)
  add_grid(-OUTER_RADIUS, -INNER_RADIUS, -INNER_RADIUS, INNER_RADIUS, OUTER_STEP)
  add_grid(INNER_RADIUS, OUTER_RADIUS, -INNER_RADIUS, INNER_RADIUS, OUTER_STEP)
  return Object.freeze({ positions: new Float32Array(positions), indices: new Uint32Array(indices) })
}

export const WATER_SURFACE_LAYOUT = create_water_surface_layout()
