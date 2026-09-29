// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import source from '../../seed/structures/thebes_arrival.recipe.json'
import workshop from '../../seed/structures/workshop.recipe.json'
import { piece_cells } from '../building_kit.mjs'
import { module_transform } from '../module_transform.mjs'
import { bake_schematic } from '../bake_schematic.mjs'
import { bake_thebes_assets } from '../bake_thebes_assets.mjs'
import { thebes_city_terrain } from '../../packages/engine/src/cities/thebes/sky_map.ts'
import { compile_world_recipe, sample_world_column } from '../../packages/engine/src/world_recipe.ts'
import { world_terrain } from '../../packages/engine/src/world_catalog.ts'
import { detail_builder } from '../../packages/engine/src/detail_builder.ts'
import { CITY_DETAIL_LIMITS, validate_details } from '../../packages/engine/src/detail_artifact.ts'

test('the authored court preserves portal clearance and both ground-level approaches', () => {
  const baked = bake_schematic({ ...workshop.assets, ...source.assets }, source.root)
  const above_ground = baked.blocks.filter(([, y]) => y >= 0)
  expect(above_ground.filter(([x, y, z]) => x >= -40 && x <= 40 && Math.abs(z) <= 2 && y < 3)).toEqual([])
  expect(above_ground.filter(([x, y, z]) => Math.abs(x) <= 8 && Math.abs(z) <= 8 && y < 6)).toEqual([])
  expect(baked.blocks.length).toBeGreaterThan(5000)
})

test('city and workshop share one bake path and one detail builder', () => {
  const world = compile_world_recipe(world_terrain('nauvis'), { city_terrain: false })
  const city = world.structures.cities.find((c) => c.id === 'thebes')
  const details = detail_builder()
  details.box([100, 70, 100], [101, 71, 101], 'thebes_limestone')
  const drafts = bake_thebes_assets(world, city, details)
  expect(new Set(drafts.map(({ type }) => type.name)).size).toBe(7)
  expect(drafts[0].type.name).toBe('thebes_portal_grove')
  expect(validate_details(details.finish(), world.recipe.materials, CITY_DETAIL_LIMITS)).toEqual([])
  expect(details.finish().some(({ origin }) => origin[0] === 96 && origin[2] === 96)).toBe(true)
}, 90000)

test('authored grove plants follow natural ground or solid ruins', () => {
  const baked = bake_schematic({ ...workshop.assets, ...source.assets }, source.root)
  const supports = new Set(baked.blocks.map(([x, y, z]) => [x, 71 + y, z].join(',')))
  const base = compile_world_recipe(world_terrain('nauvis'), { city_terrain: false })
  const city = base.structures.cities.find(({ id }) => id === 'thebes')
  const world = compile_world_recipe(
    { ...base.recipe, height_grid: thebes_city_terrain(base, city) },
    { city_terrain: false }
  )
  const plants = world.recipe.scenery.plants.filter(({ center: [x, , z] }) => Math.max(Math.abs(x), Math.abs(z)) < 60)
  expect(plants.length).toBeGreaterThan(50)
  for (const {
    center: [x, y, z],
  } of plants)
    expect(
      supports.has([Math.floor(x), y, Math.floor(z)].join(',')) ||
        y === sample_world_column(world, Math.floor(x), Math.floor(z)).surface_y
    ).toBe(true)
})

test('bench seats meet the legs without a half-block gap in any orientation', () => {
  const bench = source.assets.grove_bench
  for (const rotation of [0, 1, 2, 3]) {
    const occupied = new Set()
    const turn = module_transform({ position: [0, 0, 0], rotation })
    bench.pieces.forEach((piece) =>
      piece_cells(piece).forEach(([x, y, z]) => {
        const point = turn
          .point([(x + 0.5) / 2, (y + 0.5) / 2, (z + 0.5) / 2])
          .map((value) => Math.round(value * 2 - 0.5))
        occupied.add(point.join(','))
      })
    )
    for (const x of [0, 5])
      for (const z of [0, 1]) {
        const [px, py, pz] = turn.point([x + 0.25, 1.25, z + 0.25]).map((value) => Math.round(value * 2 - 0.5))
        expect(occupied.has([px, py - 1, pz].join(','))).toBe(true)
        expect(occupied.has([px, py, pz].join(','))).toBe(true)
      }
  }
})
