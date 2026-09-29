// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { validate_height_grid } from '../src/height_grid.ts'
import { parse_world_recipe, compile_runtime_world_recipe, sample_world_column } from '../src/world_recipe.ts'
import { world_terrain } from '../src/world_catalog.ts'

const grid = { min_x: 0, min_z: 0, cell_size: 8, width: 2, depth: 2, target_heights: [64, 64, 64, 64], cut_cells: [] }

test('malformed grids fail at the boundary instead of producing NaN terrain', () => {
  for (const change of [
    { target_heights: [64] },
    { target_heights: Array(4) },
    { target_heights: [64, NaN, 64, 64] },
    { target_heights: [64, 384, 64, 64] },
    { cell_size: 0 },
    { width: 1.5 },
    { min_x: Infinity },
    { cut_cells: [4] },
    { width: 100_000, depth: 100_000 },
  ]) {
    const height_grid = { ...grid, ...change }
    expect(validate_height_grid(height_grid).length).toBeGreaterThan(0)
    expect(() =>
      compile_runtime_world_recipe({ ...parse_world_recipe(world_terrain('nauvis')), height_grid })
    ).toThrow()
  }
  const world = compile_runtime_world_recipe({ ...parse_world_recipe(world_terrain('nauvis')), height_grid: grid })
  expect(sample_world_column(world, 8, 8).surface_y).toBe(64)
  expect(validate_height_grid({ ...grid, target_heights: [-1, 64, 64, 64], cut_cells: [0] })).toEqual([])
})

test('material identity is invariant when an owner omits structure compilation', () => {
  const recipe = world_terrain('nauvis')
  const full = compile_runtime_world_recipe(recipe)
  const surface = compile_runtime_world_recipe(recipe, { structures: false })
  expect(surface.materials.entries).toEqual(full.materials.entries)
})
