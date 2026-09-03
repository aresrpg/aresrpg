// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { sample_world_column, type CompiledWorld } from '../../world_recipe.ts'
import { generated_city_surface_height } from '../city_terrain.ts'
import type { CompiledCity, GeneratedCityTerrain } from '../types.ts'

export const RUINS_TERRAIN_CELL = 8
export const FORTRESS_OFFSET = Object.freeze({ x: -360, z: -330, half_x: 220, half_z: 150 })
export const RITUAL_OFFSET = Object.freeze({ x: 360, z: -190, radius: 118 })
type Point = readonly [number, number]
type Ravine = Readonly<{ path: readonly Point[]; width: number; depth: number }>
type Sinkhole = Readonly<{ x: number; z: number; radius: number; depth: number }>

const RAVINES: readonly Ravine[] = Object.freeze([
  {
    path: [
      [-740, -300],
      [-500, -250],
      [-260, -90],
      [0, 0],
      [270, 140],
      [520, 190],
      [790, 330],
    ],
    width: 62,
    depth: 52,
  },
  {
    path: [
      [-230, -540],
      [-180, -400],
      [-100, -220],
      [0, 0],
    ],
    width: 54,
    depth: 46,
  },
  {
    path: [
      [0, 0],
      [100, 220],
      [160, 470],
      [330, 760],
    ],
    width: 58,
    depth: 50,
  },
  {
    path: [
      [-720, 180],
      [-500, 150],
      [-270, 210],
      [-80, 330],
    ],
    width: 42,
    depth: 38,
  },
  {
    path: [
      [-600, 720],
      [-430, 560],
      [-220, 470],
      [-80, 330],
    ],
    width: 38,
    depth: 34,
  },
  {
    path: [
      [120, -500],
      [170, -320],
      [260, -120],
      [270, 140],
    ],
    width: 44,
    depth: 42,
  },
  {
    path: [
      [790, -420],
      [620, -280],
      [460, -60],
      [270, 140],
    ],
    width: 40,
    depth: 36,
  },
  {
    path: [
      [330, 760],
      [500, 620],
      [660, 540],
      [800, 500],
    ],
    width: 36,
    depth: 32,
  },
  {
    path: [
      [-740, 900],
      [-500, 820],
      [-260, 740],
      [40, 690],
    ],
    width: 34,
    depth: 30,
  },
])

const SINKHOLES: readonly Sinkhole[] = Object.freeze([
  { x: 470, z: -350, radius: 96, depth: 54 },
  { x: -540, z: 420, radius: 82, depth: 46 },
  { x: 470, z: 590, radius: 110, depth: 58 },
  { x: -250, z: 760, radius: 76, depth: 42 },
])

const segment_projection = (x: number, z: number, [ax, az]: Point, [bx, bz]: Point) => {
  const dx = bx - ax
  const dz = bz - az
  const length_squared = dx * dx + dz * dz
  const amount = length_squared === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / length_squared))
  return Object.freeze({ amount, distance: Math.hypot(x - (ax + dx * amount), z - (az + dz * amount)) })
}

const path_distance = (x: number, z: number, path: readonly Point[]): number =>
  path
    .slice(1)
    .reduce(
      (nearest, point, index) => Math.min(nearest, segment_projection(x, z, path[index]!, point).distance),
      Infinity
    )

const ravine_target = (base: number, x: number, z: number): number | null =>
  RAVINES.reduce<number | null>((target, ravine) => {
    const distance = path_distance(x, z, ravine.path)
    if (distance > ravine.width) return target
    const depth = 10 + Math.round((ravine.depth - 10) * (1 - distance / ravine.width) ** 2)
    return Math.min(target ?? base, base - depth)
  }, null)

const sinkhole_target = (base: number, x: number, z: number): number | null =>
  SINKHOLES.reduce<number | null>((target, sinkhole) => {
    const distance = Math.hypot(x - sinkhole.x, z - sinkhole.z)
    if (distance > sinkhole.radius) return target
    const depth = Math.round(sinkhole.depth * (1 - distance / sinkhole.radius) ** 2)
    return Math.min(target ?? base, base - depth)
  }, null)

const fortress_target = (base: number, datum: number, x: number, z: number): number | null => {
  const dx = Math.abs(x - FORTRESS_OFFSET.x) - FORTRESS_OFFSET.half_x
  const dz = Math.abs(z - FORTRESS_OFFSET.z) - FORTRESS_OFFSET.half_z
  const outside = Math.max(0, dx, dz)
  if (outside > 72) return null
  const amount = outside / 72
  return Math.round((datum + (base - datum) * amount) / 3) * 3
}

const ritual_target = (base: number, datum: number, x: number, z: number): number | null => {
  const distance = Math.hypot(x - RITUAL_OFFSET.x, z - RITUAL_OFFSET.z)
  if (distance > RITUAL_OFFSET.radius + 64) return null
  const amount = Math.max(0, (distance - RITUAL_OFFSET.radius) / 64)
  return Math.round((datum + (base - datum) * amount) / 2) * 2
}

const stair_target = (portal_floor: number, fortress_datum: number, x: number, z: number): number | null => {
  const gate: Point = [FORTRESS_OFFSET.x, FORTRESS_OFFSET.z + FORTRESS_OFFSET.half_z + 12]
  const { amount, distance } = segment_projection(x, z, [0, 0], gate)
  if (distance > 34) return null
  const smooth = amount * amount * (3 - 2 * amount)
  return Math.round((portal_floor + (fortress_datum - portal_floor) * smooth) / 3) * 3
}

const terrain_target = (
  world: CompiledWorld,
  city: CompiledCity,
  x: number,
  z: number,
  portal_floor: number,
  fortress_datum: number,
  ritual_datum: number
): Readonly<{ height: number; cut: boolean }> | null => {
  const base = sample_world_column(world, city.area.anchor_x + x, city.area.anchor_z + z).surface_y
  const replacements = [
    fortress_target(base, fortress_datum, x, z),
    ritual_target(base, ritual_datum, x, z),
    stair_target(portal_floor, fortress_datum, x, z),
  ].filter((value): value is number => value !== null)
  const cuts = [ravine_target(base, x, z), sinkhole_target(base, x, z)].filter(
    (value): value is number => value !== null
  )
  if (replacements.length === 0 && cuts.length === 0) return null
  const replacement = replacements.at(-1) ?? base
  const cut = Math.min(replacement, ...cuts)
  return Object.freeze({
    height: Math.max(world.recipe.sea_level + 3, cut),
    cut: cuts.length > 0 && cut <= replacement,
  })
}

export const terrain_the_ruins = (world: CompiledWorld, city: CompiledCity): GeneratedCityTerrain => {
  const width = Math.floor((city.area.max_x - city.area.min_x + 1) / RUINS_TERRAIN_CELL)
  const depth = Math.floor((city.area.max_z - city.area.min_z + 1) / RUINS_TERRAIN_CELL)
  const portal_base = sample_world_column(world, city.area.anchor_x, city.area.anchor_z).surface_y
  const portal_floor = Math.max(world.recipe.sea_level + 3, portal_base - 18)
  const fortress_x = city.area.anchor_x + FORTRESS_OFFSET.x
  const fortress_z = city.area.anchor_z + FORTRESS_OFFSET.z
  const fortress_datum = Math.max(
    world.recipe.sea_level + 34,
    sample_world_column(world, fortress_x, fortress_z).surface_y + 18
  )
  const ritual_x = city.area.anchor_x + RITUAL_OFFSET.x
  const ritual_z = city.area.anchor_z + RITUAL_OFFSET.z
  const ritual_datum = Math.max(
    world.recipe.sea_level + 28,
    sample_world_column(world, ritual_x, ritual_z).surface_y + 24
  )
  const target_heights = new Array<number>(width * depth).fill(-1)
  const cut_cells: number[] = []
  target_heights.forEach((_, index) => {
    const x = city.area.min_x + (index % width) * RUINS_TERRAIN_CELL + RUINS_TERRAIN_CELL / 2
    const z = city.area.min_z + Math.floor(index / width) * RUINS_TERRAIN_CELL + RUINS_TERRAIN_CELL / 2
    const target = terrain_target(
      world,
      city,
      x - city.area.anchor_x,
      z - city.area.anchor_z,
      portal_floor,
      fortress_datum,
      ritual_datum
    )
    if (!target) return
    target_heights[index] = target.height
    if (target.cut) cut_cells.push(index)
  })
  return Object.freeze({
    cell_size: RUINS_TERRAIN_CELL,
    width,
    depth,
    min_x: city.area.min_x,
    min_z: city.area.min_z,
    target_heights: Object.freeze(target_heights),
    cut_cells: Object.freeze(cut_cells),
  })
}

export const ruins_surface_height = (
  world: CompiledWorld,
  terrain: GeneratedCityTerrain,
  x: number,
  z: number
): number => generated_city_surface_height(terrain, x, z, sample_world_column(world, x, z).surface_y)
