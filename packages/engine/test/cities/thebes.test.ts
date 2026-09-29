// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { compile_world_recipe, sample_world_column } from '../../src/world_recipe.ts'
import { world_terrain } from '../../src/world_catalog.ts'
import { thebes_layout } from '../../src/cities/thebes/plan.ts'
import { thebes_city_terrain, generate_thebes_sky_map } from '../../src/cities/thebes/sky_map.ts'
import { build_thebes_waterways } from '../../src/cities/thebes/structures/waterway.ts'

const fixture = () => {
  const base = compile_world_recipe(world_terrain('nauvis'), { city_terrain: false })
  const city = base.structures.cities.find((c) => c.id === 'thebes')!
  const terrain = thebes_city_terrain(base, city)
  return {
    base,
    city,
    terrain,
    layout: thebes_layout(city),
    world: compile_world_recipe({ ...base.recipe, height_grid: terrain }, { city_terrain: false }),
  }
}
test('Thebes preserves strong relief, an elevated keep and a visible river between inhabited banks', () => {
  const { world, layout, city } = fixture()
  const y = (x: number, z: number) => sample_world_column(world, x, z).surface_y
  expect(y(...layout.castle) - y(city.area.anchor_x, city.area.anchor_z)).toBeGreaterThan(60)
  expect(y(...layout.cathedral)).toBe(148)
  expect(y(...layout.mountains[1]!.center)).toBeGreaterThan(280)
  layout.river.slice(0, 7).forEach(([x, z]) => expect(y(x, z)).toBeLessThan(world.recipe.sea_level))
  expect(world.recipe.canopy).toBe('clusters')
})
test('stone bridges have supported continuous decks and three blocks of headroom over the water', () => {
  const { world, layout } = fixture()
  const bridges = build_thebes_waterways(world, layout)
  bridges.forEach((structure, index) => {
    const cells = new Map<string, number>()
    structure.type.packed_voxels.forEach((p) =>
      cells.set(
        `${structure.x + (p & 255)},${structure.y + ((p >>> 16) & 255)},${structure.z + ((p >>> 8) & 255)}`,
        p >>> 24
      )
    )
    const { start, end } = layout.bridges[index]!,
      length = end[2] - start[2]
    let previous = start[1] - 1
    for (let step = 0; step <= length; step++) {
      const y = Math.round(start[1] + ((end[1] - start[1]) * step) / length) - 1
      expect(Math.abs(y - previous)).toBeLessThanOrEqual(1)
      expect(cells.get(`${start[0]},${y},${start[2] + step}`)).toBeGreaterThan(0)
      for (let h = 1; h <= 3; h++) expect(cells.get(`${start[0]},${y + h},${start[2] + step}`)).toBe(0)
      previous = y
    }
  })
})
test('city dressing keeps fields and gardens while near and far surfaces share the authored terrain', () => {
  const { base, world, city } = fixture()
  const sky = generate_thebes_sky_map(base, city)
  expect(sky.uses).toContain('field')
  expect(sky.uses).toContain('garden')
  const far = compile_world_recipe(world.recipe, { city_terrain: false, structures: false })
  for (let x = 256; x < 800; x += 37)
    for (let z = -300; z < 300; z += 43)
      expect(sample_world_column(world, x, z).surface_y).toBe(sample_world_column(far, x, z).surface_y)
})

test('the world portal stays clear and its authored approach reaches the west gate', () => {
  const { world, layout } = fixture()
  const route = layout.routes.find(
    (r) =>
      r[0]![0] === layout.arrival[0] &&
      r[0]![2] === layout.arrival[1] &&
      r.at(-1)![0] === layout.gateway[0] &&
      r.at(-1)![2] === layout.gateway[1]
  )!
  expect(route).toBeDefined()
  expect(route.at(-1)![0]).toBe(layout.gateway[0])
  expect(route.at(-1)![2]).toBe(layout.gateway[1])
  route.slice(1).forEach((end, index) => {
    const start = route[index]!,
      length = Math.ceil(Math.hypot(end[0] - start[0], end[2] - start[2]))
    let previous = sample_world_column(world, start[0], start[2]).surface_y
    for (let step = 1; step <= length; step++) {
      const x = Math.round(start[0] + ((end[0] - start[0]) * step) / length),
        z = Math.round(start[2] + ((end[2] - start[2]) * step) / length)
      const y = sample_world_column(world, x, z).surface_y
      expect(Math.abs(y - previous)).toBeLessThanOrEqual(1)
      previous = y
    }
  })
})

test('the western river mouth reaches natural ocean through a broad uninterrupted channel', () => {
  const { base, world, city } = fixture()
  // Reported closed mouth: local [-840, 288], next to the coastal relic.
  // The new estuary curves north into the natural bay instead of ending at the city edge.
  const path = [
    [-640, 272],
    [-720, 240],
    [-760, 192],
    [-768, 112],
    [-776, 32],
    [-792, -64],
  ] as const
  for (let segment = 1; segment < path.length; segment++) {
    const a = path[segment - 1]!,
      b = path[segment]!
    const length = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]))
    for (let step = 0; step <= length; step++) {
      const x = city.area.anchor_x + a[0] + ((b[0] - a[0]) * step) / length
      const z = city.area.anchor_z + a[1] + ((b[1] - a[1]) * step) / length
      for (const offset of [-12, 0, 12])
        expect(sample_world_column(world, x + offset, z).surface_y).toBeLessThan(world.recipe.sea_level)
    }
  }
  const x = city.area.anchor_x - 792,
    z = city.area.anchor_z - 64
  expect(sample_world_column(base, x, z).surface_y).toBeLessThan(base.recipe.sea_level)
  for (const offset of [-32, 0, 32])
    expect(sample_world_column(world, x + offset, z).surface_y).toBeLessThanOrEqual(
      sample_world_column(base, x + offset, z).surface_y
    )
})

test('the inhabited mountain cleft stays low and the western shoulder retains relief', () => {
  const { world } = fixture()
  for (const z of [-300, -340, -380]) expect(sample_world_column(world, 632, z).surface_y).toBeLessThan(85)
  const shoulder = [-276, -244, -212, -180, -148].map((x) => sample_world_column(world, 512 + x, -120).surface_y)
  expect(Math.max(...shoulder) - Math.min(...shoulder)).toBeGreaterThan(15)
  expect(new Set(shoulder).size).toBeGreaterThan(3)
})
