// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { sample_world_column, type CompiledWorld } from '../../world_recipe.ts'
import { city_blocks, compile_positioned_city_structure, type CityBlock } from '../city_structure.ts'
import type { CityMapStructure, CityPlacementDraft, CompiledCity, GeneratedCityTerrain } from '../types.ts'

import { FUWAGE_MATERIALS as M } from './materials.ts'

const TERRAIN_CELL = 8
const PLATEAU_RADIUS = 260
const TERRACE_RADIUS = 420
const WALL_RADIUS = 220

const plateau_datum = (world: CompiledWorld, city: CompiledCity): number =>
  Math.round(sample_world_column(world, city.area.anchor_x, city.area.anchor_z).surface_y / 8) * 8

export const terrain_fuwage = (world: CompiledWorld, city: CompiledCity): GeneratedCityTerrain => {
  const width = Math.floor((city.area.max_x - city.area.min_x + 1) / TERRAIN_CELL)
  const depth = Math.floor((city.area.max_z - city.area.min_z + 1) / TERRAIN_CELL)
  const datum = plateau_datum(world, city)
  const causeway_end = city.area.max_z - 48
  const end_height = sample_world_column(world, city.area.anchor_x, causeway_end).surface_y
  const target_heights = Array.from({ length: width * depth }, (_, index) => {
    const x = city.area.min_x + (index % width) * TERRAIN_CELL + TERRAIN_CELL / 2
    const z = city.area.min_z + Math.floor(index / width) * TERRAIN_CELL + TERRAIN_CELL / 2
    const distance = Math.max(Math.abs(x - city.area.anchor_x), Math.abs(z - city.area.anchor_z))
    const causeway_start = city.area.anchor_z + WALL_RADIUS - 12
    if (Math.abs(x - city.area.anchor_x) <= 24 && z >= causeway_start && z <= causeway_end) {
      const amount = (z - causeway_start) / (causeway_end - causeway_start)
      return Math.round(datum + (end_height - datum) * amount)
    }
    if (distance <= PLATEAU_RADIUS) return datum
    if (distance > TERRACE_RADIUS) return -1
    const base = sample_world_column(world, x, z).surface_y
    const amount = (distance - PLATEAU_RADIUS) / (TERRACE_RADIUS - PLATEAU_RADIUS)
    const terrace = Math.round((datum + (base - datum) * amount) / 4) * 4
    return terrace
  })
  return Object.freeze({
    cell_size: TERRAIN_CELL,
    width,
    depth,
    min_x: city.area.min_x,
    min_z: city.area.min_z,
    target_heights: Object.freeze(target_heights),
    cut_cells: Object.freeze([]),
  })
}

const draft = (id: string, blocks: readonly CityBlock[], world: CompiledWorld): CityPlacementDraft => {
  const structure = compile_positioned_city_structure(id, blocks, world.materials)
  return Object.freeze({ id, type: structure.type, x: structure.x, y: structure.y, z: structure.z, rotation: 0 })
}

const wall_segment = (x0: number, z0: number, x1: number, z1: number, datum: number): readonly CityBlock[] => {
  const blocks = city_blocks()
  const along_x = z0 === z1
  const length = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0))
  const direction_x = Math.sign(x1 - x0)
  const direction_z = Math.sign(z1 - z0)
  if (along_x) blocks.fill(Math.min(x0, x1), Math.max(x0, x1), datum, datum + 13, z0 - 2, z0 + 2, M.stone)
  else blocks.fill(x0 - 2, x0 + 2, datum, datum + 13, Math.min(z0, z1), Math.max(z0, z1), M.stone)
  for (let step = 0; step <= length; step += 6) {
    const center_x = x0 + direction_x * step
    const center_z = z0 + direction_z * step
    if (along_x) blocks.fill(center_x, Math.min(x1, center_x + 2), datum + 14, datum + 14, z0 - 2, z0 + 2, M.dark_stone)
    else blocks.fill(x0 - 2, x0 + 2, datum + 14, datum + 14, center_z, Math.min(z1, center_z + 2), M.dark_stone)
  }
  return blocks.finish()
}

const tower = (center_x: number, center_z: number, datum: number): readonly CityBlock[] => {
  const blocks = city_blocks()
  const radius = 10
  blocks.walls(center_x - radius, center_x + radius, datum, datum + 20, center_z - radius, center_z + radius, M.stone)
  blocks.walls(
    center_x - radius,
    center_x + radius,
    datum + 21,
    datum + 24,
    center_z - radius,
    center_z + radius,
    M.dark_stone
  )
  blocks.fill(
    center_x - radius - 2,
    center_x + radius + 2,
    datum + 21,
    datum + 21,
    center_z - radius - 2,
    center_z + radius + 2,
    M.tile
  )
  return blocks.finish()
}

const building = (
  center_x: number,
  center_z: number,
  width: number,
  depth: number,
  height: number,
  datum: number,
  door: 'north' | 'south'
): readonly CityBlock[] => {
  const blocks = city_blocks()
  const min_x = center_x - Math.floor(width / 2)
  const max_x = min_x + width
  const min_z = center_z - Math.floor(depth / 2)
  const max_z = min_z + depth
  blocks.fill(min_x, max_x, datum, datum, min_z, max_z, M.dark_stone)
  blocks.walls(min_x, max_x, datum + 1, datum + height, min_z, max_z, M.stone)
  const door_z = door === 'north' ? min_z : max_z
  blocks.clear(center_x - 2, center_x + 2, datum + 1, datum + 4, door_z, door_z)
  blocks.fill(min_x - 2, max_x + 2, datum + height + 1, datum + height + 1, min_z - 2, max_z + 2, M.tile)
  return blocks.finish()
}

const plaza = (city: CompiledCity, datum: number): readonly CityBlock[] => {
  const radius = 34
  return Object.freeze(
    Array.from({ length: (radius * 2 + 1) ** 2 }, (_, index): CityBlock | null => {
      const x = city.area.anchor_x - radius + (index % (radius * 2 + 1))
      const z = city.area.anchor_z - radius + Math.floor(index / (radius * 2 + 1))
      const distance = Math.hypot(x - city.area.anchor_x, z - city.area.anchor_z)
      if (distance > radius) return null
      return [x, datum - 1, z, distance > radius - 3 ? M.banner : M.dark_stone]
    }).filter((block): block is CityBlock => block !== null)
  )
}

const causeway = (
  city: CompiledCity,
  terrain: GeneratedCityTerrain,
  start_z: number,
  end_z: number
): readonly CityBlock[] => {
  const blocks: CityBlock[] = []
  for (let z = start_z; z <= end_z; z += 1)
    for (let x = city.area.anchor_x - 12; x <= city.area.anchor_x + 12; x += 1) {
      const target =
        terrain.target_heights[
          Math.floor((z - terrain.min_z) / terrain.cell_size) * terrain.width +
            Math.floor((x - terrain.min_x) / terrain.cell_size)
        ]!
      if (target >= 0) blocks.push([x, target - 1, z, M.dark_stone])
    }
  return Object.freeze(blocks)
}

const banner_columns = (city: CompiledCity, datum: number): readonly CityBlock[] => {
  const blocks: CityBlock[] = []
  for (const x of [city.area.anchor_x - 54, city.area.anchor_x + 54]) {
    for (let y = datum; y <= datum + 18; y += 1) blocks.push([x, y, city.area.anchor_z - 70, M.timber])
    for (let y = datum + 10; y <= datum + 18; y += 1)
      for (let width = 1; width <= 5; width += 1) blocks.push([x + width, y, city.area.anchor_z - 70, M.banner])
  }
  return Object.freeze(blocks)
}

const map_structure = (
  id: string,
  type: string,
  min_x: number,
  max_x: number,
  min_z: number,
  max_z: number
): CityMapStructure => Object.freeze({ id, type, min_x, max_x, min_z, max_z })

export const map_fuwage = (_world: CompiledWorld, city: CompiledCity): readonly CityMapStructure[] =>
  Object.freeze([
    map_structure(
      'city:fuwage:plateau',
      'fuwage_plateau',
      city.area.anchor_x - PLATEAU_RADIUS,
      city.area.anchor_x + PLATEAU_RADIUS,
      city.area.anchor_z - PLATEAU_RADIUS,
      city.area.anchor_z + PLATEAU_RADIUS
    ),
    map_structure(
      'city:fuwage:causeway',
      'fuwage_causeway',
      city.area.anchor_x - 24,
      city.area.anchor_x + 24,
      city.area.anchor_z + WALL_RADIUS - 12,
      city.area.max_z - 48
    ),
    map_structure(
      'city:fuwage:ramparts',
      'fuwage_ramparts',
      city.area.anchor_x - WALL_RADIUS - 12,
      city.area.anchor_x + WALL_RADIUS + 12,
      city.area.anchor_z - WALL_RADIUS - 12,
      city.area.anchor_z + WALL_RADIUS + 12
    ),
    map_structure(
      'city:fuwage:keep',
      'fuwage_keep',
      city.area.anchor_x - 50,
      city.area.anchor_x + 50,
      city.area.anchor_z - 190,
      city.area.anchor_z - 110
    ),
    map_structure(
      'city:fuwage:dungeon-plaza',
      'fuwage_dungeon_plaza',
      city.area.anchor_x - 34,
      city.area.anchor_x + 34,
      city.area.anchor_z - 34,
      city.area.anchor_z + 34
    ),
  ])

export const plan_fuwage = (world: CompiledWorld, city: CompiledCity): readonly CityPlacementDraft[] => {
  const datum = plateau_datum(world, city)
  const terrain = terrain_fuwage(world, city)
  const left = city.area.anchor_x - WALL_RADIUS
  const right = city.area.anchor_x + WALL_RADIUS
  const north = city.area.anchor_z - WALL_RADIUS
  const south = city.area.anchor_z + WALL_RADIUS
  const causeway_start = city.area.anchor_z + WALL_RADIUS - 12
  const causeway_end = city.area.max_z - 48
  const causeway_segments = Array.from(
    { length: Math.ceil((causeway_end - causeway_start + 1) / 220) },
    (_, index) =>
      [causeway_start + index * 220, Math.min(causeway_end, causeway_start + (index + 1) * 220 - 1)] as const
  )
  const wall_drafts = [
    [left, north, city.area.anchor_x, north],
    [city.area.anchor_x, north, right, north],
    [left, south, city.area.anchor_x - 12, south],
    [city.area.anchor_x + 12, south, right, south],
    [left, north, left, city.area.anchor_z],
    [left, city.area.anchor_z, left, south],
    [right, north, right, city.area.anchor_z],
    [right, city.area.anchor_z, right, south],
  ] as const
  return Object.freeze([
    ...wall_drafts.map(([x0, z0, x1, z1], index) =>
      draft(`city:fuwage:wall:${index}`, wall_segment(x0, z0, x1, z1, datum), world)
    ),
    ...[
      [left, north],
      [right, north],
      [left, south],
      [right, south],
    ].map(([x, z], index) => draft(`city:fuwage:tower:${index}`, tower(x!, z!, datum), world)),
    draft(
      'city:fuwage:keep',
      building(city.area.anchor_x, city.area.anchor_z - 150, 100, 80, 24, datum, 'south'),
      world
    ),
    draft(
      'city:fuwage:barracks:west',
      building(city.area.anchor_x - 130, city.area.anchor_z, 62, 34, 12, datum, 'south'),
      world
    ),
    draft(
      'city:fuwage:barracks:east',
      building(city.area.anchor_x + 130, city.area.anchor_z, 62, 34, 12, datum, 'south'),
      world
    ),
    draft('city:fuwage:dungeon-plaza', plaza(city, datum), world),
    ...causeway_segments.map(([start_z, end_z], index) =>
      draft(`city:fuwage:causeway:${index}`, causeway(city, terrain, start_z, end_z), world)
    ),
    draft('city:fuwage:banners', banner_columns(city, datum), world),
  ])
}
