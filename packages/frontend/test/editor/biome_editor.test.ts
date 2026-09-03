// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { compile_world_recipe, parse_world_recipe, sample_biome_grid, sample_world_column } from '@aresrpg/engine'

import worlds from '../../../../seed/content/worlds.json'
import {
  biome_preview,
  move_spline_knot,
  terrain_patch,
  world_height_domain,
  world_height_graph_domain,
} from '../../src/editor/biome_editor.ts'

test('the biome preview is the engine biome grid with derived coverage', () => {
  const world = worlds.find(({ world }) => world === 'nauvis')
  if (!world?.terrain) throw new Error('Nauvis terrain missing')
  const exact = sample_biome_grid(parse_world_recipe(world.terrain), {
    world_size: 100_000,
    world_center: 50_000,
    cell_size: 512,
  })
  const preview = biome_preview(world.terrain)
  expect(preview.side).toBe(exact.side)
  expect(preview.cells).toEqual(exact.cells)
  expect(preview.coverage.reduce((sum, count) => sum + count, 0)).toBe(exact.cells.length)
}, 15_000)

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
  const terrain = worlds.find(({ world }) => world === 'nauvis')?.terrain
  if (!terrain) throw new Error('Nauvis terrain missing')

  expect(world_height_domain()).toEqual([0, 383])
  expect(world_height_graph_domain()).toEqual([0, 384])
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

test('Nauvis shoreline splines stay within the one-block traversal step', () => {
  const terrain = worlds.find(({ world }) => world === 'nauvis')?.terrain
  if (!terrain) throw new Error('Nauvis terrain missing')
  const world = compile_world_recipe(parse_world_recipe(terrain), { structures: false })
  const rises: number[] = []

  for (let z = -1024; z < -768; z += 1)
    for (let x = -1024; x < -768; x += 1) {
      const height = sample_world_column(world, x, z).surface_y
      const neighbours = [
        sample_world_column(world, x + 1, z).surface_y,
        sample_world_column(world, x, z + 1).surface_y,
      ]
      neighbours.forEach((neighbour) => {
        if (
          Math.min(height, neighbour) <= terrain.sea_level + 8 &&
          Math.max(height, neighbour) >= terrain.sea_level - 2
        )
          rises.push(Math.abs(height - neighbour))
      })
    }

  expect(Math.max(...rises)).toBeLessThanOrEqual(1)
})
