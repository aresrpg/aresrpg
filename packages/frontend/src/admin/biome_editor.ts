// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  compile_world_recipe,
  MAX_SURFACE_Y,
  parse_world_recipe,
  sample_biome_grid,
  sample_world_column,
  surface_layer_for_slope,
  terrain_slope,
  type WorldRecipe,
  type MaterialPreset,
} from '@aresrpg/engine'
import { chain_to_client_coordinate, world_center, world_size } from '@aresrpg/immutable'
import { ZONE_SIZE } from '@aresrpg/protocol'

export const biome_preview = (value: unknown) => {
  const recipe = parse_world_recipe(value)
  const grid = sample_biome_grid(recipe, { world_size, world_center, cell_size: ZONE_SIZE })
  const coverage = recipe.biomes.map((_, biome_index) =>
    grid.cells.reduce((count, cell) => count + Number(cell === biome_index), 0)
  )
  return Object.freeze({ ...grid, coverage: Object.freeze(coverage) })
}

export const sample_biome_cell = (value: unknown, column: number, row: number) => {
  const recipe = parse_world_recipe(value)
  const world = compile_world_recipe(recipe)
  const x = chain_to_client_coordinate(column * ZONE_SIZE + ZONE_SIZE / 2)
  const z = chain_to_client_coordinate(row * ZONE_SIZE + ZONE_SIZE / 2)
  return Object.freeze({ x, z, ...sample_world_column(world, x, z) })
}

export const first_biome_land = (biome: WorldRecipe['biomes'][number]) =>
  biome.landscape.find(({ land }) => land)?.land ?? null

export const world_height_domain = (): readonly [number, number] => [0, MAX_SURFACE_Y]

export type TerrainPatch = Readonly<{
  side: number
  columns: readonly Readonly<{
    column: number
    row: number
    x: number
    z: number
    surface_y: number
    biome: string
    color: string
    preset: MaterialPreset
  }>[]
}>

export const terrain_patch = (
  value: unknown,
  options: Readonly<{ center_x: number; center_z: number; side?: number; spacing?: number }>
): TerrainPatch => {
  const recipe = parse_world_recipe(value)
  const world = compile_world_recipe(recipe)
  const side = options.side ?? 17
  const spacing = options.spacing ?? 64
  const offset = (side - 1) / 2
  const samples = Array.from({ length: side * side }, (_, index) => {
    const column = index % side
    const row = Math.floor(index / side)
    const x = options.center_x + (column - offset) * spacing
    const z = options.center_z + (row - offset) * spacing
    return Object.freeze({ column, row, x, z, sample: sample_world_column(world, x, z) })
  })
  const columns = samples.map(({ column, row, x, z, sample }, index) => {
    const neighbours = [
      column > 0 ? samples[index - 1] : undefined,
      column + 1 < side ? samples[index + 1] : undefined,
      row > 0 ? samples[index - side] : undefined,
      row + 1 < side ? samples[index + side] : undefined,
    ].flatMap((candidate) => (candidate ? [candidate.sample.surface_y] : []))
    const layer = surface_layer_for_slope(terrain_slope(sample.surface_y, neighbours, spacing))
    const material = recipe.materials[sample.land[layer]]
    return Object.freeze({
      column,
      row,
      x,
      z,
      surface_y: sample.surface_y,
      biome: sample.biome.name,
      color: material?.color ?? '#000000',
      preset: material?.preset ?? 'stone',
    })
  })
  return Object.freeze({ side, columns: Object.freeze(columns) })
}

export const move_spline_knot = (
  knots: readonly (readonly [number, number])[],
  index: number,
  point: readonly [number, number]
): readonly (readonly [number, number])[] => {
  if (index < 0 || index >= knots.length) return knots
  const previous_x = knots[index - 1]?.[0]
  const next_x = knots[index + 1]?.[0]
  const minimum = previous_x === undefined ? -Infinity : previous_x + 0.0001
  const maximum = next_x === undefined ? Infinity : next_x - 0.0001
  const x = Math.max(minimum, Math.min(maximum, point[0]))
  return Object.freeze(
    knots.map((knot, knot_index): readonly [number, number] =>
      knot_index === index ? Object.freeze([x, point[1]]) : knot
    )
  )
}
