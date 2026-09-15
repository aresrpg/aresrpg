// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { BIOME_SLOTS, compile_world_recipe, type WorldRecipe } from '@aresrpg/engine'

import { sample_relief_grid } from '../../../src/game/hud/minimap_render.ts'

const recipe: WorldRecipe = {
  seed: 'map-water',
  sea_level: 40,
  liquid: 'water',
  materials: { ground: { color: '#55aa22', preset: 'grass' }, water: { color: '#246bbb', preset: 'water' } },
  biome_slots: Object.fromEntries(BIOME_SLOTS.map((slot) => [slot, 'shore'])) as WorldRecipe['biome_slots'],
  biomes: [
    {
      name: 'shore',
      landscape: [
        { x: 0, y: 20, land: { surface: 'ground', subsurface: 'ground', filler: 'ground' } },
        { x: 1, y: 20 },
      ],
    },
  ],
}

test('underwater map cells show the authored blue water surface instead of the seabed', () => {
  const world = compile_world_recipe(recipe, { structures: false, city_terrain: false })
  const grid = sample_relief_grid(world, 0, 0, 8, 2)
  expect([...grid.heights]).toEqual([40, 40, 40, 40])
  for (let index = 0; index < grid.colors.length; index += 3) {
    expect(grid.colors[index + 2]!).toBeGreaterThan(grid.colors[index + 1]!)
    expect(grid.colors[index + 1]!).toBeGreaterThan(grid.colors[index]!)
  }
})

test('dry worlds and exposed shores keep their actual ground material and relief', () => {
  for (const dry of [
    { ...recipe, liquid: undefined },
    { ...recipe, sea_level: 20 },
  ]) {
    const grid = sample_relief_grid(compile_world_recipe(dry, { structures: false, city_terrain: false }), 0, 0, 8, 2)
    expect([...grid.heights]).toEqual([20, 20, 20, 20])
    expect(grid.colors[1]!).toBeGreaterThan(grid.colors[2]!)
  }
})
