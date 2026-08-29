// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { compile_world_recipe, sample_world_column, type WorldRecipe } from './world_recipe.ts'

const CELL_SAMPLES_PER_AXIS = 4

export type BiomeGrid = Readonly<{
  side: number
  cells: Uint8Array
}>

export const sample_biome_grid = (
  recipe: WorldRecipe,
  options: Readonly<{ world_size: number; world_center: number; cell_size: number }>
): BiomeGrid => {
  const { world_size, world_center, cell_size } = options
  if (![world_size, world_center, cell_size].every(Number.isSafeInteger) || world_size < 1 || cell_size < 1)
    throw new TypeError('Biome grid dimensions must be positive safe integers')
  const world = compile_world_recipe(recipe, { structures: false })
  if (world.biomes.length > 0x100) throw new TypeError('A biome grid supports at most 256 biomes')
  const side = Math.ceil(world_size / cell_size)
  if (side > 0xffff) throw new TypeError('Biome grid side exceeds u16')
  const cells = new Uint8Array(side * side)
  for (let row = 0; row < side; row += 1) {
    for (let column = 0; column < side; column += 1) {
      const counts = new Uint8Array(world.biomes.length)
      for (let sample = 0; sample < CELL_SAMPLES_PER_AXIS ** 2; sample += 1) {
        const sample_row = Math.floor(sample / CELL_SAMPLES_PER_AXIS)
        const sample_column = sample % CELL_SAMPLES_PER_AXIS
        const x = column * cell_size + ((sample_column + 0.5) * cell_size) / CELL_SAMPLES_PER_AXIS - world_center
        const z = row * cell_size + ((sample_row + 0.5) * cell_size) / CELL_SAMPLES_PER_AXIS - world_center
        const { biome } = sample_world_column(world, x, z)
        const biome_id = world.biomes.indexOf(biome)
        if (biome_id < 0) throw new Error(`Sampled biome "${biome.name}" is not part of its compiled world`)
        counts[biome_id] += 1
      }
      const center = sample_world_column(
        world,
        column * cell_size + cell_size / 2 - world_center,
        row * cell_size + cell_size / 2 - world_center
      ).biome
      const center_id = world.biomes.indexOf(center)
      const biome_id = counts.reduce(
        (selected, count, candidate) => (count > counts[selected]! ? candidate : selected),
        center_id
      )
      cells[row * side + column] = biome_id
    }
  }
  return Object.freeze({ side, cells })
}
