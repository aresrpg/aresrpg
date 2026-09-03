// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { CompiledWorld } from '../../world_recipe.ts'
import { compile_positioned_city_structure, type CityBlock } from '../city_structure.ts'
import type { CityMapStructure, CityPlacementDraft, CompiledCity, GeneratedCityTerrain } from '../types.ts'

import { THE_RUINS_MATERIALS as M } from './materials.ts'
import { RUIN_OFFSETS, ruins_monuments, TOWER_OFFSETS, WALL_SEGMENTS } from './monuments.ts'
import { FORTRESS_OFFSET, RITUAL_OFFSET, ruins_surface_height, terrain_the_ruins } from './terrain.ts'
import { RUINS_MINE_BOUNDS, ruins_underground, type RuinsBlockDraft } from './underground.ts'

const SKY_CELL = 16

const draft = ({ id, blocks }: RuinsBlockDraft, world: CompiledWorld): CityPlacementDraft => {
  const structure = compile_positioned_city_structure(id, blocks, world.materials)
  return Object.freeze({ id, type: structure.type, x: structure.x, y: structure.y, z: structure.z, rotation: 0 })
}

const dungeon_plaza = (
  world: CompiledWorld,
  city: CompiledCity,
  terrain: GeneratedCityTerrain
): readonly CityBlock[] => {
  const radius = 18
  return Object.freeze(
    Array.from({ length: (radius * 2 + 1) ** 2 }, (_, index): CityBlock | null => {
      const x = city.area.anchor_x - radius + (index % (radius * 2 + 1))
      const z = city.area.anchor_z - radius + Math.floor(index / (radius * 2 + 1))
      const distance = Math.hypot(x - city.area.anchor_x, z - city.area.anchor_z)
      if (distance > radius) return null
      return [x, ruins_surface_height(world, terrain, x, z) - 1, z, distance >= radius - 2 ? M.silk : M.masonry]
    }).filter((block): block is CityBlock => block !== null)
  )
}

const map_structure = (
  id: string,
  type: string,
  min_x: number,
  max_x: number,
  min_z: number,
  max_z: number
): CityMapStructure => Object.freeze({ id, type, min_x, max_x, min_z, max_z })

const cut_map = (city: CompiledCity, terrain: GeneratedCityTerrain): readonly CityMapStructure[] => {
  const width = Math.floor((city.area.max_x - city.area.min_x + 1) / SKY_CELL)
  const depth = Math.floor((city.area.max_z - city.area.min_z + 1) / SKY_CELL)
  const cuts = new Set(terrain.cut_cells)
  const active = (x: number, z: number): boolean => cuts.has(z * 2 * terrain.width + x * 2)
  const rows: CityMapStructure[] = []
  for (let z = 0; z < depth; z += 1) {
    let x = 0
    while (x < width) {
      if (!active(x, z)) {
        x += 1
        continue
      }
      let end = x
      while (end + 1 < width && active(end + 1, z)) end += 1
      rows.push(
        map_structure(
          `city:the_ruins:ravine:${x}:${z}:${end}`,
          'the_ruins_ravine',
          city.area.min_x + x * SKY_CELL,
          city.area.min_x + (end + 1) * SKY_CELL - 1,
          city.area.min_z + z * SKY_CELL,
          city.area.min_z + (z + 1) * SKY_CELL - 1
        )
      )
      x = end + 1
    }
  }
  return Object.freeze(rows)
}

export const map_the_ruins = (world: CompiledWorld, city: CompiledCity): readonly CityMapStructure[] => {
  const terrain = terrain_the_ruins(world, city)
  return Object.freeze([
    map_structure(
      'city:the_ruins:dungeon-plaza',
      'the_ruins_dungeon_plaza',
      city.area.anchor_x - 18,
      city.area.anchor_x + 18,
      city.area.anchor_z - 18,
      city.area.anchor_z + 18
    ),
    ...cut_map(city, terrain),
    map_structure(
      'city:the_ruins:fortress',
      'the_ruins_fortress',
      city.area.anchor_x + FORTRESS_OFFSET.x - FORTRESS_OFFSET.half_x,
      city.area.anchor_x + FORTRESS_OFFSET.x + FORTRESS_OFFSET.half_x,
      city.area.anchor_z + FORTRESS_OFFSET.z - FORTRESS_OFFSET.half_z,
      city.area.anchor_z + FORTRESS_OFFSET.z + FORTRESS_OFFSET.half_z
    ),
    map_structure(
      'city:the_ruins:ritual',
      'the_ruins_ritual',
      city.area.anchor_x + RITUAL_OFFSET.x - RITUAL_OFFSET.radius,
      city.area.anchor_x + RITUAL_OFFSET.x + RITUAL_OFFSET.radius,
      city.area.anchor_z + RITUAL_OFFSET.z - RITUAL_OFFSET.radius,
      city.area.anchor_z + RITUAL_OFFSET.z + RITUAL_OFFSET.radius
    ),
    ...RUIN_OFFSETS.map(([x, z], index) =>
      map_structure(
        `city:the_ruins:ruin:${index}`,
        'the_ruins_ruin',
        city.area.anchor_x + x - 12,
        city.area.anchor_x + x + 12,
        city.area.anchor_z + z - 12,
        city.area.anchor_z + z + 12
      )
    ),
    ...TOWER_OFFSETS.map(([x, z], index) =>
      map_structure(
        `city:the_ruins:tower:${index}`,
        'the_ruins_ruin',
        city.area.anchor_x + x - 12,
        city.area.anchor_x + x + 12,
        city.area.anchor_z + z - 12,
        city.area.anchor_z + z + 12
      )
    ),
    ...WALL_SEGMENTS.map(([x0, z0, x1, z1], index) =>
      map_structure(
        `city:the_ruins:broken-wall:${index}`,
        'the_ruins_ruin',
        city.area.anchor_x + Math.min(x0, x1) - 6,
        city.area.anchor_x + Math.max(x0, x1) + 6,
        city.area.anchor_z + Math.min(z0, z1) - 6,
        city.area.anchor_z + Math.max(z0, z1) + 6
      )
    ),
    map_structure(
      'city:the_ruins:mineshaft',
      'the_ruins_mineshaft',
      city.area.anchor_x + RUINS_MINE_BOUNDS.min_x,
      city.area.anchor_x + RUINS_MINE_BOUNDS.max_x,
      city.area.anchor_z + RUINS_MINE_BOUNDS.min_z,
      city.area.anchor_z + RUINS_MINE_BOUNDS.max_z
    ),
  ])
}

export const plan_the_ruins = (world: CompiledWorld, city: CompiledCity): readonly CityPlacementDraft[] => {
  const terrain = terrain_the_ruins(world, city)
  const floor_y = ruins_surface_height(world, terrain, city.area.anchor_x, city.area.anchor_z)
  const blocks = [
    ...ruins_underground(city, floor_y),
    Object.freeze({ id: 'city:the_ruins:20:dungeon-plaza', blocks: dungeon_plaza(world, city, terrain) }),
    ...ruins_monuments(world, city, terrain),
  ]
  return Object.freeze(blocks.map((source) => draft(source, world)))
}

export { terrain_the_ruins }
