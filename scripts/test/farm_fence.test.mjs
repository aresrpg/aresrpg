// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import source from '../../seed/structures/thebes_farmstead.recipe.json'
import { compile_world_recipe, sample_world_column } from '../../packages/engine/src/world_recipe.ts'
import { world_terrain } from '../../packages/engine/src/world_catalog.ts'
import { thebes_layout } from '../../packages/engine/src/cities/thebes/plan.ts'
import { thebes_city_terrain } from '../../packages/engine/src/cities/thebes/sky_map.ts'
import { module_transform } from '../module_transform.mjs'

test('both posts of every farm fence meet the actual terrace', () => {
  const base = compile_world_recipe(world_terrain('nauvis'), { city_terrain: false })
  const city = base.structures.cities.find(({ id }) => id === 'thebes')
  const world = compile_world_recipe(
    { ...base.recipe, height_grid: thebes_city_terrain(base, city) },
    { city_terrain: false }
  )
  const [x, z] = thebes_layout(city).farmhouse
  const y = sample_world_column(world, x, z).surface_y
  const fences = source.assets.farmstead.parts.filter(({ asset }) => asset === 'fence')
  expect(fences.length).toBeGreaterThan(0)
  for (const part of fences)
    for (const dx of [0, 4]) {
      const [px, py, pz] = module_transform(part).point([dx, 0, 0])
      expect(y + py).toBe(sample_world_column(world, x + px, z + pz).surface_y)
    }
})
