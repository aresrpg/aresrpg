// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { compile_world_recipe, sample_world_column, type WorldRecipe } from './world_recipe.ts'

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
  const world = compile_world_recipe(recipe)
  if (world.biomes.length > 0x100) throw new TypeError('A biome grid supports at most 256 biomes')
  const side = Math.ceil(world_size / cell_size)
  if (side > 0xffff) throw new TypeError('Biome grid side exceeds u16')
  const cells = new Uint8Array(side * side)
  for (let row = 0; row < side; row += 1) {
    for (let column = 0; column < side; column += 1) {
      const x = column * cell_size + cell_size / 2 - world_center
      const z = row * cell_size + cell_size / 2 - world_center
      const { biome } = sample_world_column(world, x, z)
      const biome_id = world.biomes.indexOf(biome)
      if (biome_id < 0) throw new Error(`Sampled biome "${biome.name}" is not part of its compiled world`)
      cells[row * side + column] = biome_id
    }
  }
  return Object.freeze({ side, cells })
}
