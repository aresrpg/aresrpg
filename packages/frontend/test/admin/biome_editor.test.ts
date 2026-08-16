// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { compile_world_recipe, parse_world_recipe, sample_biome_grid, sample_world_column } from '@aresrpg/engine'

import worlds from '../../../../seed/content/worlds.json'
import { biome_preview, move_spline_knot, terrain_patch } from '../../src/admin/biome_editor.ts'

test('the biome preview is the engine biome grid with derived coverage', () => {
  const world = worlds.find(({ world }) => world === '01_first_shore')
  if (!world?.terrain) throw new Error('first shore terrain missing')
  const exact = sample_biome_grid(parse_world_recipe(world.terrain), {
    world_size: 100_000,
    world_center: 50_000,
    cell_size: 512,
  })
  const preview = biome_preview(world.terrain)
  expect(preview.side).toBe(exact.side)
  expect(preview.cells).toEqual(exact.cells)
  expect(preview.coverage.reduce((sum, count) => sum + count, 0)).toBe(exact.cells.length)
})

test('spline knot movement preserves strict x ordering', () => {
  const knots = [
    [0, 1],
    [0.5, 2],
    [1, 3],
  ] as const
  expect(move_spline_knot(knots, 1, [2, 4])).toEqual([
    [0, 1],
    [0.9999, 4],
    [1, 3],
  ])
})

test('the terrain patch uses exact engine columns for its live voxel preview', () => {
  const terrain = worlds[0]?.terrain
  if (!terrain) throw new Error('first terrain missing')
  const patch = terrain_patch(terrain, { center_x: 128, center_z: -64, side: 3, spacing: 32 })
  const [, , , , middle] = patch.columns
  const exact = sample_world_column(compile_world_recipe(parse_world_recipe(terrain)), 128, -64)
  expect(middle).toMatchObject({ x: 128, z: -64, surface_y: exact.surface_y, biome: exact.biome.name })
  expect(middle.color).toBe(parse_world_recipe(terrain).materials[exact.biome.land.surface])
})
