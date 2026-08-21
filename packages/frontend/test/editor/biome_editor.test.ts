// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { compile_world_recipe, parse_world_recipe, sample_biome_grid, sample_world_column } from '@aresrpg/engine'

import worlds from '../../../../seed/content/worlds.json'
import { biome_preview, move_spline_knot, terrain_patch, world_height_domain } from '../../src/editor/biome_editor.ts'

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

test('the spline graph keeps one world-wide elevation domain', () => {
  const terrain = worlds.find(({ world }) => world === '01_first_shore')?.terrain
  if (!terrain) throw new Error('first shore terrain missing')

  expect(world_height_domain()).toEqual([0, 383])
})

test('the first shore preserves the legacy nine-climate biome matrix', () => {
  const terrain = worlds.find(({ world }) => world === '01_first_shore')?.terrain
  if (!terrain) throw new Error('first shore terrain missing')

  expect(terrain.biomes.map(({ name }) => name)).toEqual([
    'taiga',
    'glacier',
    'arctic',
    'grassland',
    'temperate',
    'swamp',
    'scorched',
    'desert',
    'tropical',
  ])
  expect(terrain.biome_slots).toEqual({
    low_low: 'taiga',
    low_mid: 'glacier',
    low_high: 'arctic',
    mid_low: 'grassland',
    mid_mid: 'temperate',
    mid_high: 'swamp',
    high_low: 'scorched',
    high_mid: 'desert',
    high_high: 'tropical',
  })
})

test('the terrain patch uses exact engine columns for its live voxel preview', () => {
  const terrain = worlds[0]?.terrain
  if (!terrain) throw new Error('first terrain missing')
  const patch = terrain_patch(terrain, { center_x: 128, center_z: -64, side: 3, spacing: 32 })
  const [, , , , middle] = patch.columns
  const exact = sample_world_column(compile_world_recipe(parse_world_recipe(terrain)), 128, -64)
  expect(middle).toMatchObject({ x: 128, z: -64, surface_y: exact.surface_y, biome: exact.biome.name })
  expect(middle.color).toBe(parse_world_recipe(terrain).materials[exact.land.surface]?.color)
})

test('the first shore reads as varied coherent geography at world scale', () => {
  const terrain = worlds.find(({ world }) => world === '01_first_shore')?.terrain
  if (!terrain) throw new Error('first shore terrain missing')
  const world = compile_world_recipe(parse_world_recipe(terrain))
  const side = 196
  const spacing = 512
  const columns = Array.from({ length: side * side }, (_, index) => {
    const x = (index % side) * spacing - 50_000
    const z = Math.floor(index / side) * spacing - 50_000
    return sample_world_column(world, x, z)
  })
  const heights = columns.map(({ surface_y }) => surface_y).sort((left, right) => left - right)
  const count_by = (key: (column: (typeof columns)[number]) => string) =>
    columns.reduce<Record<string, number>>((counts, column) => {
      const value = key(column)
      return { ...counts, [value]: (counts[value] ?? 0) + 1 }
    }, {})
  const biome_counts = Object.values(count_by(({ biome }) => biome.name))
  const surface_counts = Object.values(count_by(({ land }) => land.surface))
  const meaningful = (counts: readonly number[]) => counts.filter((count) => count / columns.length >= 0.01).length
  const matching_neighbors = columns.reduce(
    (matches, column, index) =>
      matches +
      (index % side > 0 && columns[index - 1]?.biome.name === column.biome.name ? 1 : 0) +
      (index >= side && columns[index - side]?.biome.name === column.biome.name ? 1 : 0),
    0
  )
  const neighbor_count = 2 * side * (side - 1)
  const land_share = columns.filter(({ surface_y }) => surface_y >= terrain.sea_level).length / columns.length

  expect(meaningful(biome_counts)).toBeGreaterThanOrEqual(6)
  expect(Math.max(...biome_counts) / columns.length).toBeLessThanOrEqual(0.35)
  expect(meaningful(surface_counts)).toBeGreaterThanOrEqual(6)
  expect(matching_neighbors / neighbor_count).toBeGreaterThanOrEqual(0.58)
  expect(land_share).toBeGreaterThanOrEqual(0.97)
  expect(land_share).toBeLessThan(1)
  expect(heights[Math.floor(heights.length * 0.05)]).toBeLessThanOrEqual(70)
  expect(heights[Math.floor(heights.length * 0.95)]).toBeGreaterThanOrEqual(170)
})
