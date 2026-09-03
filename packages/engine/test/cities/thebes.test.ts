// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import worlds from '../../../../seed/content/worlds.json'
import { plan_thebes_tiles, THEBES_CELL, thebes_road_bits } from '../../src/cities/thebes/plan.ts'
import { generate_thebes_sky_map, thebes_city_terrain, THEBES_SKY_CELL } from '../../src/cities/thebes/sky_map.ts'
import { thebes_road_paths } from '../../src/cities/thebes/structures/road.ts'
import { build_thebes_landscape } from '../../src/cities/thebes/structures/landscape.ts'
import { build_thebes_wall } from '../../src/cities/thebes/structures/wall.ts'
import { compile_world_recipe, parse_world_recipe, sample_world_column } from '../../src/world_recipe.ts'

const thebes_world = () => {
  const nauvis = worlds.find(({ world }) => world === 'nauvis')
  if (!nauvis?.terrain) throw new Error('Nauvis terrain is missing')
  const terrain = {
    ...structuredClone(nauvis.terrain),
    structure_areas: [
      {
        id: 'thebes',
        min_x: -336,
        max_x: 1199,
        min_z: -848,
        max_z: 687,
        anchor_x: 512,
        anchor_z: 0,
        structure_packs: ['temperate_trees', 'temperate_ruins'],
      },
    ],
  }
  return compile_world_recipe(parse_world_recipe(terrain))
}

const direction = (bit: number) => {
  if (bit === thebes_road_bits.WEST) return [-1, 0] as const
  if (bit === thebes_road_bits.EAST) return [1, 0] as const
  if (bit === thebes_road_bits.NORTH) return [0, -1] as const
  return [0, 1] as const
}

const reachable_roads = (
  cells: ReturnType<typeof plan_thebes_tiles>['cells'],
  width: number,
  start: number
): ReadonlySet<number> => {
  const visited = new Set([start])
  const queue = [start]
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const cell = cells[queue[cursor]!]!
    for (const bit of Object.values(thebes_road_bits)) {
      if ((cell.openings & bit) === 0) continue
      const [dx, dz] = direction(bit)
      const neighbour = (cell.z + dz) * width + cell.x + dx
      if (cells[neighbour]?.kind === 'road' && !visited.has(neighbour)) {
        visited.add(neighbour)
        queue.push(neighbour)
      }
    }
  }
  return visited
}

describe('City of Thebes plan', () => {
  test('covers its 3x3 territory with one deterministic connected land plan', () => {
    const world = thebes_world()
    const city = world.structures.cities[0]!
    const first = plan_thebes_tiles(world, city)
    const second = plan_thebes_tiles(world, city)
    const portal_x = Math.floor((city.area.anchor_x - city.area.min_x) / THEBES_CELL)
    const portal_z = Math.floor((city.area.anchor_z - city.area.min_z) / THEBES_CELL)
    const portal = portal_z * first.width + portal_x
    const reachable = reachable_roads(first.cells, first.width, portal)

    expect(first).toEqual(second)
    expect(first.width).toBe(24)
    expect(first.depth).toBe(24)
    expect(first.cells.filter(({ kind }) => kind === 'road').length).toBeGreaterThan(100)
    expect(first.cells.filter(({ kind }) => kind === 'lot').length).toBeGreaterThan(20)
    first.landmarks.forEach(({ x, z, entrance }) => {
      const [dx, dz] = direction(entrance)
      expect(reachable.has((z + dz) * first.width + x + dx)).toBeTrue()
    })
    first.gates.forEach(({ target }) => expect(reachable.has(target)).toBeTrue())
  })

  test('keeps every occupied plan cell out of ocean terrain', () => {
    const world = thebes_world()
    const city = world.structures.cities[0]!
    const plan = plan_thebes_tiles(world, city)
    plan.cells
      .filter(({ kind }) => kind !== 'empty')
      .forEach(({ x, z }) => {
        const world_x = city.area.min_x + x * THEBES_CELL + THEBES_CELL / 2
        const world_z = city.area.min_z + z * THEBES_CELL + THEBES_CELL / 2
        expect(sample_world_column(world, world_x, world_z).biome).not.toBe(world.ocean?.biome)
      })
  })

  test('shares the carved city surface with structure-free far terrain', () => {
    const complete = thebes_world()
    const surface_only = compile_world_recipe(complete.recipe, { structures: false })
    const city = complete.structures.cities[0]!
    for (let x = city.area.min_x; x <= city.area.max_x; x += 73)
      for (let z = city.area.min_z; z <= city.area.max_z; z += 79)
        expect(sample_world_column(complete, x, z).surface_y).toBe(sample_world_column(surface_only, x, z).surface_y)
  })

  test('keeps engineered roads within three blocks of rise per eight horizontal blocks', () => {
    const world = thebes_world()
    const base = compile_world_recipe(world.recipe, { city_terrain: false })
    const city = base.structures.cities[0]!
    const plan = plan_thebes_tiles(base, city)
    const terrain = thebes_city_terrain(base, city, generate_thebes_sky_map(base, city, plan))
    const cuts = new Set(terrain.cut_cells)
    const road_indexes = terrain.target_heights.flatMap((height, index) =>
      height >= 0 && !cuts.has(index) ? [index] : []
    )

    expect(terrain.cell_size).toBe(8)
    expect(road_indexes.length).toBeGreaterThan(1_000)
    road_indexes.forEach((index) => {
      const x = index % terrain.width
      const z = Math.floor(index / terrain.width)
      const neighbours = [
        x + 1 < terrain.width ? index + 1 : -1,
        z + 1 < terrain.depth ? index + terrain.width : -1,
        x + 1 < terrain.width && z + 1 < terrain.depth ? index + terrain.width + 1 : -1,
      ]
      neighbours.forEach((neighbour) => {
        if (neighbour < 0 || terrain.target_heights[neighbour]! < 0 || cuts.has(neighbour)) return
        expect(Math.abs(terrain.target_heights[index]! - terrain.target_heights[neighbour]!)).toBeLessThanOrEqual(3)
      })
    })
    const carved = road_indexes.find((index) => {
      const x = terrain.min_x + (index % terrain.width) * terrain.cell_size + terrain.cell_size / 2
      const z = terrain.min_z + Math.floor(index / terrain.width) * terrain.cell_size + terrain.cell_size / 2
      return sample_world_column(base, x, z).surface_y > terrain.target_heights[index]!
    })!
    const carved_x = terrain.min_x + (carved % terrain.width) * terrain.cell_size + terrain.cell_size / 2
    const carved_z = terrain.min_z + Math.floor(carved / terrain.width) * terrain.cell_size + terrain.cell_size / 2
    expect(sample_world_column(world, carved_x, carved_z).surface_y).toBe(terrain.target_heights[carved])
    road_indexes.forEach((index) => {
      const x = index % terrain.width
      const z = Math.floor(index / terrain.width)
      const world_x = terrain.min_x + x * terrain.cell_size + terrain.cell_size / 2
      const world_z = terrain.min_z + z * terrain.cell_size + terrain.cell_size / 2
      const height = sample_world_column(world, world_x, world_z).surface_y
      const neighbours = [x + 1 < terrain.width ? index + 1 : -1, z + 1 < terrain.depth ? index + terrain.width : -1]
      neighbours.forEach((neighbour) => {
        if (neighbour < 0 || terrain.target_heights[neighbour]! < 0 || cuts.has(neighbour)) return
        const neighbour_x = terrain.min_x + (neighbour % terrain.width) * terrain.cell_size + terrain.cell_size / 2
        const neighbour_z =
          terrain.min_z + Math.floor(neighbour / terrain.width) * terrain.cell_size + terrain.cell_size / 2
        expect(Math.abs(height - sample_world_column(world, neighbour_x, neighbour_z).surface_y)).toBeLessThanOrEqual(3)
      })
    })
  })

  test('cuts the generated river below the real water plane', () => {
    const world = thebes_world()
    const base = compile_world_recipe(world.recipe, { city_terrain: false })
    const city = world.structures.cities[0]!
    const plan = plan_thebes_tiles(base, city)
    const terrain = thebes_city_terrain(base, city, generate_thebes_sky_map(base, city, plan))
    const source = terrain.cut_cells.find((index) => {
      const x = terrain.min_x + (index % terrain.width) * terrain.cell_size + terrain.cell_size / 2
      const z = terrain.min_z + Math.floor(index / terrain.width) * terrain.cell_size + terrain.cell_size / 2
      return sample_world_column(base, x, z).surface_y > world.recipe.sea_level
    })!
    const x = terrain.min_x + (source % terrain.width) * terrain.cell_size + terrain.cell_size / 2
    const z = terrain.min_z + Math.floor(source / terrain.width) * terrain.cell_size + terrain.cell_size / 2

    expect(sample_world_column(world, x, z).surface_y).toBe(world.recipe.sea_level - 3)
  })

  test('keeps every surviving fence grounded on the final city surface', () => {
    const world = thebes_world()
    const base = compile_world_recipe(world.recipe, { city_terrain: false })
    const city = base.structures.cities[0]!
    const plan = plan_thebes_tiles(base, city)
    const sky = generate_thebes_sky_map(base, city, plan)
    const surface_y = (x: number, z: number): number => sample_world_column(world, x, z).surface_y
    const columns = new Map<string, Readonly<{ x: number; z: number; min_y: number; max_y: number }>>()

    build_thebes_landscape(base, city, sky, surface_y).forEach((structure) => {
      const [anchor_x, anchor_y, anchor_z] = structure.type.anchor
      structure.type.packed_voxels.forEach((packed) => {
        const x = structure.x + (packed & 0xff) - anchor_x
        const y = structure.y + ((packed >>> 16) & 0xff) - anchor_y
        const z = structure.z + ((packed >>> 8) & 0xff) - anchor_z
        const key = `${x}:${z}`
        const column = columns.get(key)
        columns.set(key, {
          x,
          z,
          min_y: Math.min(column?.min_y ?? y, y),
          max_y: Math.max(column?.max_y ?? y, y),
        })
      })
    })

    expect(columns.size).toBeGreaterThan(1_000)
    columns.forEach(({ x, z, min_y, max_y }) => {
      const ground = surface_y(x, z)
      expect(min_y).toBeGreaterThanOrEqual(ground)
      expect(max_y).toBeLessThanOrEqual(ground + 2)
    })
  })

  test('turns steep road arms into terrain-following switchbacks', () => {
    const world = thebes_world()
    const city = world.structures.cities[0]!
    const plan = plan_thebes_tiles(world, city)
    const switchbacks = plan.cells.flatMap((cell, order) => {
      if (cell.kind !== 'road') return []
      const origin_x = city.area.min_x + cell.x * THEBES_CELL
      const origin_z = city.area.min_z + cell.z * THEBES_CELL
      return thebes_road_paths(world, origin_x, origin_z, cell.openings, world.decoration_seed + order).filter(
        (points) => points.length === 6
      )
    })

    expect(switchbacks.length).toBeGreaterThan(0)
    switchbacks.forEach((points) => expect(points).toHaveLength(6))
  })

  test('generates one organic land-use sky map before placing dense district frontage', () => {
    const world = thebes_world()
    const city = world.structures.cities[0]!
    const plan = plan_thebes_tiles(world, city)
    const sky = generate_thebes_sky_map(world, city, plan)
    const uses = new Set(sky.uses)
    const districts = new Set(sky.buildings.map(({ district }) => district))

    expect(sky.width).toBe(96)
    expect(sky.depth).toBe(96)
    expect(sky.buildings.length).toBeGreaterThan(1_000)
    expect(sky.river_path.length).toBeGreaterThan(8)
    expect(uses).toEqual(new Set(['water', 'river', 'bridge', 'street', 'urban', 'garden', 'field', 'wild']))
    expect(districts).toEqual(new Set(['old_town', 'residential', 'artisan', 'noble', 'military']))
    sky.buildings.forEach(({ center_x, center_z }) => {
      const x = Math.floor((center_x - city.area.min_x) / THEBES_SKY_CELL)
      const z = Math.floor((center_z - city.area.min_z) / THEBES_SKY_CELL)
      expect(sky.uses[z * sky.width + x]).toBe('urban')
      expect(sample_world_column(world, center_x, center_z).biome).not.toBe(world.ocean?.biome)
    })
  })

  test('adds supported interior access stairs at regular city-wall intervals', () => {
    const world = thebes_world()
    const city = world.structures.cities[0]!
    const stairs = build_thebes_wall(world, city.area, 'north', 2, false, 2)!
    const plain = build_thebes_wall(world, city.area, 'north', 3, false, 3)!

    expect(stairs.type.packed_voxels.length).toBeGreaterThan(plain.type.packed_voxels.length)
  })
})
