// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { GeneratedCityTerrain } from './types.ts'

const cut_indexes = new WeakMap<GeneratedCityTerrain, ReadonlySet<number>>()

const cuts_for = (terrain: GeneratedCityTerrain): ReadonlySet<number> => {
  const cached = cut_indexes.get(terrain)
  if (cached) return cached
  const indexes = new Set(terrain.cut_cells)
  cut_indexes.set(terrain, indexes)
  return indexes
}

const inside = (terrain: GeneratedCityTerrain, x: number, z: number): boolean =>
  x >= 0 && x < terrain.width && z >= 0 && z < terrain.depth

const height_at = (terrain: GeneratedCityTerrain, x: number, z: number): number =>
  inside(terrain, x, z) ? terrain.target_heights[z * terrain.width + x]! : -1

const distance_to_cell = (terrain: GeneratedCityTerrain, index: number, x: number, z: number): number => {
  const cell_x = index % terrain.width
  const cell_z = Math.floor(index / terrain.width)
  const min_x = terrain.min_x + cell_x * terrain.cell_size
  const min_z = terrain.min_z + cell_z * terrain.cell_size
  const dx = Math.max(min_x - x, 0, x - (min_x + terrain.cell_size - 1))
  const dz = Math.max(min_z - z, 0, z - (min_z + terrain.cell_size - 1))
  return Math.hypot(dx, dz)
}

const nearby_indexes = (terrain: GeneratedCityTerrain, x: number, z: number): readonly number[] => {
  const center_x = Math.floor((x - terrain.min_x) / terrain.cell_size)
  const center_z = Math.floor((z - terrain.min_z) / terrain.cell_size)
  const indexes: number[] = []
  for (let offset_z = -1; offset_z <= 1; offset_z += 1)
    for (let offset_x = -1; offset_x <= 1; offset_x += 1) {
      const cell_x = center_x + offset_x
      const cell_z = center_z + offset_z
      if (inside(terrain, cell_x, cell_z)) indexes.push(cell_z * terrain.width + cell_x)
    }
  return indexes
}

const nearest_distance = (
  terrain: GeneratedCityTerrain,
  indexes: readonly number[],
  x: number,
  z: number,
  accepts: (index: number) => boolean
): number =>
  indexes.reduce(
    (distance, index) => (accepts(index) ? Math.min(distance, distance_to_cell(terrain, index, x, z)) : distance),
    Infinity
  )

const interpolated_target_height = (terrain: GeneratedCityTerrain, x: number, z: number): number | null => {
  const grid_x = (x - terrain.min_x) / terrain.cell_size - 0.5
  const grid_z = (z - terrain.min_z) / terrain.cell_size - 0.5
  const min_x = Math.floor(grid_x)
  const min_z = Math.floor(grid_z)
  const amount_x = grid_x - min_x
  const amount_z = grid_z - min_z
  const heights = [
    height_at(terrain, min_x, min_z),
    height_at(terrain, min_x + 1, min_z),
    height_at(terrain, min_x, min_z + 1),
    height_at(terrain, min_x + 1, min_z + 1),
  ]
  const available = heights.filter((height) => height >= 0)
  if (available.length === 0) return null
  const fallback = available.reduce((sum, height) => sum + height, 0) / available.length
  const [north_west, north_east, south_west, south_east] = heights.map((height) => (height < 0 ? fallback : height))
  const north = north_west! + (north_east! - north_west!) * amount_x
  const south = south_west! + (south_east! - south_west!) * amount_x
  return north + (south - north) * amount_z
}

export const generated_city_surface_height = (
  terrain: GeneratedCityTerrain,
  x: number,
  z: number,
  surface_y: number
): number => {
  const nearby = nearby_indexes(terrain, x, z)
  const cuts = cuts_for(terrain)
  const active = (index: number): boolean => terrain.target_heights[index]! >= 0
  const distance = nearest_distance(terrain, nearby, x, z, active)
  const nearest_cut_distance = nearest_distance(terrain, nearby, x, z, (index) => active(index) && cuts.has(index))
  const target = interpolated_target_height(terrain, x, z)
  const feather = terrain.cell_size / 2
  if (target === null || distance > feather) return surface_y
  const amount = 1 - distance / feather
  const smooth = amount * amount * (3 - 2 * amount)
  const shaped = Math.round(surface_y + (target - surface_y) * smooth)
  return nearest_cut_distance <= distance ? Math.min(surface_y, shaped) : shaped
}

export type { GeneratedCityTerrain } from './types.ts'
