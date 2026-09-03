// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { hash_position } from '../../world_noise.ts'
import { city_blocks, type CityBlock } from '../city_structure.ts'
import type { CompiledCity, GeneratedCityTerrain } from '../types.ts'
import type { CompiledWorld } from '../../world_recipe.ts'

import { THE_RUINS_MATERIALS as M } from './materials.ts'
import { FORTRESS_OFFSET, RITUAL_OFFSET, ruins_surface_height } from './terrain.ts'
import type { RuinsBlockDraft } from './underground.ts'

type HorizontalPoint = readonly [x: number, z: number]

export const RUIN_OFFSETS = Object.freeze(
  [-500, -340, -180, -20, 140, 300, 460, 620].flatMap((x, column) =>
    [-470, -300, -130, 40, 210, 380, 550, 720, 890].flatMap((z, row) => {
      const near_fortress = Math.abs(x - FORTRESS_OFFSET.x) < 250 && Math.abs(z - FORTRESS_OFFSET.z) < 180
      const near_ritual = Math.hypot(x - RITUAL_OFFSET.x, z - RITUAL_OFFSET.z) < 170
      const near_portal = Math.hypot(x, z) < 125
      return near_fortress || near_ritual || near_portal || (column * 3 + row) % 7 === 0 ? [] : [[x, z] as const]
    })
  )
)

export const TOWER_OFFSETS = Object.freeze([
  [-650, -430],
  [-90, -470],
  [250, -430],
  [650, -250],
  [-640, 40],
  [570, 130],
  [-520, 360],
  [460, 430],
  [-420, 720],
  [120, 760],
  [630, 720],
] as const)

export const WALL_SEGMENTS = Object.freeze([
  [-610, 160, -470, 160],
  [-350, 270, -350, 410],
  [-120, 650, 30, 650],
  [210, 520, 360, 520],
  [530, 250, 530, 390],
  [520, -40, 660, -40],
  [80, -390, 190, -390],
  [-620, 610, -500, 610],
] as const)

const ruin = (
  world: CompiledWorld,
  terrain: GeneratedCityTerrain,
  center_x: number,
  center_z: number,
  order: number
): readonly CityBlock[] => {
  const ground = ruins_surface_height(world, terrain, center_x, center_z) - 1
  const radius = 7 + (order % 4)
  const height = 9 + (order % 5) * 2
  const seed = hash_position(world.decoration_seed, 'the_ruins:collapse', center_x, center_z, order)
  const blocks = city_blocks()
  blocks.fill(center_x - radius, center_x + radius, ground, ground, center_z - radius, center_z + radius, M.stone)
  blocks.walls(
    center_x - radius,
    center_x + radius,
    ground + 1,
    ground + height,
    center_z - radius,
    center_z + radius,
    M.masonry
  )
  blocks.clear(center_x - 2, center_x + 2, ground + 1, ground + 4, center_z + radius, center_z + radius)
  if (order % 3 === 0)
    blocks.fill(center_x - radius - 2, center_x + radius + 2, ground + 4, ground + 5, center_z, center_z, M.masonry)
  return Object.freeze(
    blocks.finish().filter(([x, y, z]) => y <= ground + 3 || hash_position(seed, 'missing', x, z, y) % 11 >= 3)
  )
}

const tower = (
  world: CompiledWorld,
  terrain: GeneratedCityTerrain,
  center_x: number,
  center_z: number,
  order: number
): readonly CityBlock[] => {
  const ground = ruins_surface_height(world, terrain, center_x, center_z) - 1
  const radius = 9 + (order % 3)
  const height = 34 + (order % 5) * 5
  const seed = hash_position(world.decoration_seed, 'the_ruins:tower', center_x, center_z, order)
  const blocks = city_blocks()
  blocks.fill(center_x - radius, center_x + radius, ground, ground + 1, center_z - radius, center_z + radius, M.stone)
  blocks.walls(
    center_x - radius,
    center_x + radius,
    ground + 2,
    ground + height,
    center_z - radius,
    center_z + radius,
    M.masonry
  )
  blocks.clear(center_x - 2, center_x + 2, ground + 2, ground + 5, center_z + radius, center_z + radius)
  for (let level = ground + 8; level < ground + height; level += 8) {
    blocks.fill(
      center_x - radius + 2,
      center_x + radius - 2,
      level,
      level,
      center_z - radius + 2,
      center_z + radius - 2,
      M.timber
    )
    blocks.clear(center_x - 2, center_x + 2, level, level, center_z - 2, center_z + 2)
  }
  return Object.freeze(
    blocks.finish().filter(([x, y, z]) => y < ground + height - 8 || hash_position(seed, 'crown', x, z, y) % 9 >= 3)
  )
}

const broken_wall = (
  world: CompiledWorld,
  terrain: GeneratedCityTerrain,
  city: CompiledCity,
  [x0, z0, x1, z1]: (typeof WALL_SEGMENTS)[number],
  order: number
): readonly CityBlock[] => {
  const blocks = city_blocks()
  const length = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0))
  for (let step = 0; step <= length; step += 1) {
    if ((Math.floor(step / 13) + order) % 5 === 2) continue
    const amount = step / length
    const x = city.area.anchor_x + Math.round(x0 + (x1 - x0) * amount)
    const z = city.area.anchor_z + Math.round(z0 + (z1 - z0) * amount)
    const ground = ruins_surface_height(world, terrain, x, z) - 1
    const height = 6 + ((step + order * 7) % 8)
    blocks.fill(x, x, ground, ground + height, z, z, M.masonry)
    if (step % 18 === 0) blocks.fill(x - 2, x + 2, ground, ground + 3, z - 2, z + 2, M.stone)
  }
  return blocks.finish()
}

const wall_footprint = (x0: number, z0: number, x1: number, z1: number): readonly HorizontalPoint[] => {
  if (z0 === z1) {
    const min_x = Math.min(x0, x1)
    const width = Math.abs(x1 - x0) + 1
    return Object.freeze(
      Array.from(
        { length: width * 7 },
        (_, index) => [min_x + (index % width), z0 - 3 + Math.floor(index / width)] as const
      )
    )
  }
  const min_z = Math.min(z0, z1)
  const depth = Math.abs(z1 - z0) + 1
  return Object.freeze(
    Array.from(
      { length: depth * 7 },
      (_, index) => [x0 - 3 + Math.floor(index / depth), min_z + (index % depth)] as const
    )
  )
}

const grounded_wall = (
  world: CompiledWorld,
  terrain: GeneratedCityTerrain,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  datum: number
): readonly CityBlock[] => {
  return Object.freeze(
    wall_footprint(x0, z0, x1, z1).flatMap(([x, z]): readonly CityBlock[] => {
      const surface = ruins_surface_height(world, terrain, x, z)
      if (surface < datum - 8) return []
      const bottom = Math.min(datum, surface)
      return Array.from({ length: datum + 19 - bottom }, (_, index): CityBlock => [x, bottom + index, z, M.masonry])
    })
  )
}

const fortress_wall = (
  world: CompiledWorld,
  terrain: GeneratedCityTerrain,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  datum: number,
  order: number
): readonly CityBlock[] => {
  const blocks = city_blocks()
  grounded_wall(world, terrain, x0, z0, x1, z1, datum).forEach(([x, y, z, material]) => blocks.set(x, y, z, material))
  const along_x = z0 === z1
  const broken_start = order % 2 === 0 ? 0.32 : 0.62
  const length = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0))
  for (
    let step = Math.floor(length * broken_start);
    step < Math.min(length, Math.floor(length * broken_start) + 24);
    step += 1
  ) {
    const x = x0 + Math.sign(x1 - x0) * step
    const z = z0 + Math.sign(z1 - z0) * step
    if (along_x) blocks.clear(x, x, datum + 7, datum + 18, z0 - 3, z0 + 3)
    else blocks.clear(x0 - 3, x0 + 3, datum + 7, datum + 18, z, z)
  }
  return blocks.finish()
}

const fortress = (
  world: CompiledWorld,
  terrain: GeneratedCityTerrain,
  city: CompiledCity
): readonly RuinsBlockDraft[] => {
  const center_x = city.area.anchor_x + FORTRESS_OFFSET.x
  const center_z = city.area.anchor_z + FORTRESS_OFFSET.z
  const datum = ruins_surface_height(world, terrain, center_x, center_z) - 1
  const left = center_x - FORTRESS_OFFSET.half_x
  const right = center_x + FORTRESS_OFFSET.half_x
  const north = center_z - FORTRESS_OFFSET.half_z
  const south = center_z + FORTRESS_OFFSET.half_z
  const edges = [
    [left, north, center_x, north],
    [center_x, north, right, north],
    [left, south, center_x - 18, south],
    [center_x + 18, south, right, south],
    [left, north, left, center_z],
    [left, center_z, left, south],
    [right, north, right, center_z],
    [right, center_z, right, south],
  ] as const
  const keep = city_blocks()
  keep.fill(center_x - 70, center_x + 70, datum, datum, center_z - 62, center_z + 45, M.stone)
  keep.walls(center_x - 70, center_x + 70, datum + 1, datum + 27, center_z - 62, center_z + 45, M.masonry)
  keep.clear(center_x - 7, center_x + 7, datum + 1, datum + 10, center_z + 45, center_z + 45)
  keep.clear(center_x + 28, center_x + 70, datum + 15, datum + 27, center_z - 62, center_z - 20)
  return Object.freeze([
    ...edges.map(([x0, z0, x1, z1], order) =>
      Object.freeze({
        id: `city:the_ruins:20:fortress-wall:${order}`,
        blocks: fortress_wall(world, terrain, x0, z0, x1, z1, datum, order),
      })
    ),
    Object.freeze({ id: 'city:the_ruins:20:fortress-keep', blocks: keep.finish() }),
  ])
}

const disc = (center_x: number, y: number, center_z: number, radius: number, material: string): readonly CityBlock[] =>
  Object.freeze(
    Array.from({ length: (radius * 2 + 1) ** 2 }, (_, index): CityBlock | null => {
      const x = (index % (radius * 2 + 1)) - radius
      const z = Math.floor(index / (radius * 2 + 1)) - radius
      return x * x + z * z <= radius * radius ? [center_x + x, y, center_z + z, material] : null
    }).filter((block): block is CityBlock => block !== null)
  )

const fang = (
  center_x: number,
  center_z: number,
  ground: number,
  angle: number,
  height: number
): readonly CityBlock[] => {
  const blocks: CityBlock[] = []
  for (let y = 0; y < height; y += 1) {
    const amount = y / height
    const radius = Math.max(1, Math.round(6 * (1 - amount) + 1))
    const curve = Math.round(amount * amount * 13)
    const layer_x = Math.round(center_x + Math.cos(angle) * curve)
    const layer_z = Math.round(center_z + Math.sin(angle) * curve)
    blocks.push(...disc(layer_x, ground + y, layer_z, radius, y % 11 === 6 ? M.silk : M.bone))
  }
  return Object.freeze(blocks)
}

const ritual_fangs = (
  world: CompiledWorld,
  terrain: GeneratedCityTerrain,
  city: CompiledCity
): readonly RuinsBlockDraft[] =>
  Object.freeze(
    Array.from({ length: 8 }, (_, order) => {
      const angle = (order / 8) * Math.PI * 2
      const center_x = city.area.anchor_x + RITUAL_OFFSET.x + Math.round(Math.cos(angle) * 78)
      const center_z = city.area.anchor_z + RITUAL_OFFSET.z + Math.round(Math.sin(angle) * 78)
      const ground = ruins_surface_height(world, terrain, center_x, center_z) - 1
      return Object.freeze({
        id: `city:the_ruins:20:ritual-fang:${order}`,
        blocks: fang(center_x, center_z, ground, angle + Math.PI, 38 + (order % 4) * 5),
      })
    })
  )

const stair_sections = (
  world: CompiledWorld,
  terrain: GeneratedCityTerrain,
  city: CompiledCity
): readonly RuinsBlockDraft[] => {
  const gate_x = city.area.anchor_x + FORTRESS_OFFSET.x
  const gate_z = city.area.anchor_z + FORTRESS_OFFSET.z + FORTRESS_OFFSET.half_z + 12
  return Object.freeze(
    Array.from({ length: 3 }, (_, section) => {
      const blocks = city_blocks()
      const from = section / 3
      const to = (section + 1) / 3
      for (let step = Math.floor(from * 400); step <= Math.ceil(to * 400); step += 1) {
        const amount = step / 400
        const center_x = Math.round(city.area.anchor_x + (gate_x - city.area.anchor_x) * amount)
        const center_z = Math.round(city.area.anchor_z + (gate_z - city.area.anchor_z) * amount)
        const y = ruins_surface_height(world, terrain, center_x, center_z) - 1
        for (let width = -12; width <= 12; width += 1) blocks.set(center_x + width, y, center_z - width * 2, M.stone)
        if (step % 12 === 0) {
          blocks.fill(center_x - 15, center_x - 13, y, y + 4, center_z + 26, center_z + 30, M.masonry)
          blocks.fill(center_x + 13, center_x + 15, y, y + 4, center_z - 30, center_z - 26, M.masonry)
        }
      }
      return Object.freeze({ id: `city:the_ruins:20:monumental-stair:${section}`, blocks: blocks.finish() })
    })
  )
}

export const ruins_monuments = (
  world: CompiledWorld,
  city: CompiledCity,
  terrain: GeneratedCityTerrain
): readonly RuinsBlockDraft[] =>
  Object.freeze([
    ...fortress(world, terrain, city),
    ...stair_sections(world, terrain, city),
    ...ritual_fangs(world, terrain, city),
    ...TOWER_OFFSETS.map(([offset_x, offset_z], order) =>
      Object.freeze({
        id: `city:the_ruins:20:ancient-tower:${String(order).padStart(2, '0')}`,
        blocks: tower(world, terrain, city.area.anchor_x + offset_x, city.area.anchor_z + offset_z, order),
      })
    ),
    ...WALL_SEGMENTS.map((segment, order) =>
      Object.freeze({
        id: `city:the_ruins:20:broken-wall:${String(order).padStart(2, '0')}`,
        blocks: broken_wall(world, terrain, city, segment, order),
      })
    ),
    ...RUIN_OFFSETS.map(([offset_x, offset_z], order) =>
      Object.freeze({
        id: `city:the_ruins:20:ruin:${String(order).padStart(2, '0')}`,
        blocks: ruin(world, terrain, city.area.anchor_x + offset_x, city.area.anchor_z + offset_z, order),
      })
    ),
  ])
