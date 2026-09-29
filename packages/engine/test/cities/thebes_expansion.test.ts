// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { compile_world_recipe, sample_world_column } from '../../src/world_recipe.ts'
import { world_terrain } from '../../src/world_catalog.ts'
import { generate_thebes_sky_map, thebes_city_terrain } from '../../src/cities/thebes/sky_map.ts'
import { build_thebes_sublevels, thebes_catacomb_layout } from '../../src/cities/thebes/structures/sublevels.ts'
import { build_thebes_landscape } from '../../src/cities/thebes/structures/landscape.ts'
import { build_thebes_rural } from '../../src/cities/thebes/structures/rural.ts'
import { thebes_layout } from '../../src/cities/thebes/plan.ts'
import type { PositionedCityStructure } from '../../src/cities/city_structure.ts'

const fixture = () => {
  const base = compile_world_recipe(world_terrain('nauvis'), { city_terrain: false })
  const city = base.structures.cities.find(({ id }) => id === 'thebes')!
  const sky = generate_thebes_sky_map(base, city)
  const terrain = thebes_city_terrain(base, city)
  const world = compile_world_recipe({ ...base.recipe, height_grid: terrain }, { city_terrain: false })
  return { base, city, sky, terrain, world }
}

const operations = (structures: readonly PositionedCityStructure[]) => {
  const cells = new Map<string, number>()
  structures.forEach(({ x, y, z, type }) =>
    type.packed_voxels.forEach((packed) => {
      cells.set(`${x + (packed & 255)},${y + ((packed >>> 16) & 255)},${z + ((packed >>> 8) & 255)}`, packed >>> 24)
    })
  )
  return cells
}

test('catacomb entries, all six crypts and their connecting halls share supported walkable clearance', () => {
  const { world, city } = fixture()
  const layout = thebes_catacomb_layout(world, city)
  const cells = operations(build_thebes_sublevels(world, city))
  const walkable = (x: number, floor: number, z: number) => {
    expect(cells.get(`${x},${floor},${z}`)).toBeGreaterThan(0)
    expect(cells.get(`${x},${floor + 1},${z}`)).toBe(0)
    expect(cells.get(`${x},${floor + 2},${z}`)).toBe(0)
  }
  for (const dx of [-48, 0, 48]) for (let dz = -48; dz <= 64; dz++) walkable(layout.x + dx, layout.y, layout.z + dz)
  for (let dx = -64; dx <= 64; dx++) walkable(layout.x + dx, layout.y, layout.z + 64)
  for (const side of [-1, 1]) {
    const x = layout.x + side * 64
    const surface = sample_world_column(world, x, layout.z).surface_y - 1
    expect(surface - layout.y).toBeLessThanOrEqual(60)
    for (let step = 0; step <= 64; step++) walkable(x, Math.max(layout.y, surface - step), layout.z + step)
  }
})

test('rural districts contain planted soil, harvest props and genuinely large rooted trees', () => {
  const { world, city, sky } = fixture()
  const structures = build_thebes_rural(world, city, sky)
  const trees = structures.filter(({ type }) => type.name.startsWith('tree_') && type.size[1] >= 50)
  const farms = structures.filter(({ type }) => type.name.includes('farm_'))
  expect(trees.length).toBeGreaterThanOrEqual(6)
  expect(farms.length).toBeGreaterThan(0)
  expect(trees.every(({ type }) => type.size[1] >= 50)).toBe(true)
  const soil = world.materials.id_for('rich_soil')
  const first_field = sky.uses.indexOf('field')
  const plot = build_thebes_landscape(
    world,
    city,
    { ...sky, uses: sky.uses.map((use, index) => (index === first_field ? use : 'wild')) },
    (x, z) => sample_world_column(world, x, z).surface_y
  )
  expect(plot[0]!.type.packed_voxels.some((packed) => packed >>> 24 === soil)).toBe(true)
}, 15000)

test('the cemetery stair reaches the existing catacombs with continuous supported clearance', () => {
  const { world, city } = fixture()
  const { y } = thebes_catacomb_layout(world, city)
  const [x, z] = thebes_layout(city).cemetery_entry
  const surface = sample_world_column(world, x, z).surface_y - 1
  const length = Math.max(64, surface - y + 4)
  const cells = operations(build_thebes_sublevels(world, city))
  for (let step = 0; step <= length; step++) {
    const floor = Math.max(y, surface - step)
    expect(cells.get(`${x},${floor},${z + step}`)).toBeGreaterThan(0)
    expect(cells.get(`${x},${floor + 1},${z + step}`)).toBe(0)
    expect(cells.get(`${x},${floor + 2},${z + step}`)).toBe(0)
  }
  for (let along = z + length; along < city.area.anchor_z; along++) {
    expect(cells.get(`${x},${y},${along}`)).toBeGreaterThan(0)
    expect(cells.get(`${x},${y + 1},${along}`)).toBe(0)
    expect(cells.get(`${x},${y + 2},${along}`)).toBe(0)
  }
})
