// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { MAX_SURFACE_Y } from './voxel_data.ts'

const positive_integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0

/** Sparse grids use -1 for an unauthored cell; every other entry is an absolute voxel elevation. */
export const validate_height_grid = (value: unknown): readonly string[] => {
  if (value === undefined) return []
  if (!value || typeof value !== 'object') return ['height_grid must be an object']
  const grid = value as Readonly<Record<string, unknown>>
  const dimensions = [grid.width, grid.depth, grid.cell_size]
  if (!dimensions.every(positive_integer)) return ['height_grid dimensions must be positive safe integers']
  const count = Number(grid.width) * Number(grid.depth)
  if (count > 1_048_576) return ['height_grid exceeds one million cells']
  const extents = [
    grid.min_x,
    grid.min_z,
    Number(grid.min_x) + Number(grid.width) * Number(grid.cell_size),
    Number(grid.min_z) + Number(grid.depth) * Number(grid.cell_size),
  ]
  if (!extents.every(Number.isSafeInteger)) return ['height_grid origins and extents must be safe integers']
  const heights = grid.target_heights
  const cuts = grid.cut_cells
  const errors: string[] = []
  if (
    !Array.isArray(heights) ||
    heights.length !== count ||
    !Array.from(heights).every((y: unknown) => Number.isInteger(y) && Number(y) >= -1 && Number(y) <= MAX_SURFACE_Y)
  )
    errors.push(`height_grid must supply exactly width × depth integer heights within -1..${MAX_SURFACE_Y}`)
  if (
    !Array.isArray(cuts) ||
    !Array.from(cuts).every((index: unknown) => Number.isInteger(index) && Number(index) >= 0 && Number(index) < count)
  )
    errors.push('height_grid cut_cells must contain valid cell indices')
  return errors
}
