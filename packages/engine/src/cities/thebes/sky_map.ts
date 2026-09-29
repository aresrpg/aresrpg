// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { sample_world_column, type CompiledWorld } from '../../world_recipe.ts'
import type { CompiledCity, GeneratedCityTerrain } from '../types.ts'

import { in_reserved_plot, thebes_layout, type ThebesLayout } from './plan.ts'
import type { RoadPoint } from './structures/road.ts'

export const THEBES_SKY_CELL = 16
export type ThebesLandUse = 'water' | 'river' | 'bridge' | 'street' | 'urban' | 'garden' | 'field' | 'wild' | 'grove'
export type ThebesSkyMap = Readonly<{
  width: number
  depth: number
  uses: readonly ThebesLandUse[]
  street_paths: readonly (readonly RoadPoint[])[]
  river_path: readonly RoadPoint[]
  castle_center: RoadPoint
}>
export const segment_projection = (x: number, z: number, a: RoadPoint, b: RoadPoint) => {
  const dx = b[0] - a[0],
    dz = b[1] - a[1]
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)))
  return { t, distance: Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t) }
}
export const path_distance = (x: number, z: number, path: readonly RoadPoint[]): number =>
  Math.min(...path.slice(1).map((end, index) => segment_projection(x, z, path[index]!, end).distance))

/** Signed distance from the authored channel edge; negative values are inside the river. */
const river_bank_distance = (x: number, z: number, layout: ThebesLayout): number =>
  Math.min(
    ...layout.river.slice(1).map((end, index) => {
      const { distance, t } = segment_projection(x, z, layout.river[index]!, end)
      const width = layout.river_widths[index]! + (layout.river_widths[index + 1]! - layout.river_widths[index]!) * t
      return distance - width
    })
  )

const terrace_distance = (x: number, z: number, t: ThebesLayout['terraces'][number]): number => {
  const dx = Math.abs(x - (t.min_x + t.max_x) / 2) - (t.max_x - t.min_x) / 2 + t.rounding
  const dz = Math.abs(z - (t.min_z + t.max_z) / 2) - (t.max_z - t.min_z) / 2 + t.rounding
  return Math.max(0, Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dz), 0) - t.rounding)
}

const route_surface = (x: number, z: number, layout: ThebesLayout) =>
  layout.routes
    .flatMap((route) =>
      route.slice(1).map((b, index) => {
        const a = route[index]!
        const projection = segment_projection(x, z, [a[0], a[2]], [b[0], b[2]])
        return { ...projection, height: a[1] + (b[1] - a[1]) * projection.t }
      })
    )
    .reduce((best, next) => (next.distance < best.distance ? next : best))

const sculpted_height = (world: CompiledWorld, layout: ThebesLayout, x: number, z: number): number => {
  const natural = sample_world_column(world, x, z).surface_y
  const mountain = layout.mountains.reduce((height, peak) => {
    const distance = Math.hypot(x - peak.center[0], z - peak.center[1]) / peak.radius
    const ridge = Math.max(0, 1 - distance) * (peak.height - natural)
    return Math.max(
      height,
      natural + ridge * (0.84 + 0.16 * Math.cos(Math.atan2(z - peak.center[1], x - peak.center[0]) * 7))
    )
  }, natural)
  const terrace = layout.terraces.reduce((best, next) =>
    terrace_distance(x, z, next) < terrace_distance(x, z, best) ? next : best
  )
  const distance = terrace_distance(x, z, terrace)
  const blend = Math.max(0, 1 - distance / 32)
  const height = mountain + (terrace.height - mountain) * blend
  const river_distance = river_bank_distance(x, z, layout)
  const bed = Math.min(natural, world.recipe.sea_level - 4)
  if (river_distance < 0) return bed
  const bank_blend = Math.max(0, Math.min(1, river_distance / 16))
  const bank = bed + (height - bed) * bank_blend
  const route = route_surface(x, z, layout)
  // A bridge owns its deck; the height field keeps the water and void underneath.
  if (river_distance < 20) return Math.round(bank)
  if (Math.max(Math.abs(x - layout.castle[0]), Math.abs(z - layout.castle[1])) <= 28) return layout.keep_height
  const road_blend = Math.max(0, Math.min(1, (18 - route.distance) / 6))
  return Math.round(bank + (route.height - bank) * road_blend)
}

export const thebes_city_terrain = (world: CompiledWorld, city: CompiledCity): GeneratedCityTerrain => {
  const layout = thebes_layout(city),
    cell_size = 8
  const width = Math.floor((city.area.max_x - city.area.min_x + 1) / cell_size),
    depth = Math.floor((city.area.max_z - city.area.min_z + 1) / cell_size)
  const target_heights = Array.from({ length: width * depth }, (_, index) => {
    const x = city.area.min_x + ((index % width) + 0.5) * cell_size,
      z = city.area.min_z + (Math.floor(index / width) + 0.5) * cell_size
    return sculpted_height(world, layout, x, z)
  })
  return { cell_size, width, depth, min_x: city.area.min_x, min_z: city.area.min_z, target_heights, cut_cells: [] }
}

const land_use = (world: CompiledWorld, layout: ThebesLayout, x: number, z: number): ThebesLandUse => {
  if (river_bank_distance(x, z, layout) < 4) return 'river'
  if (in_reserved_plot(layout, x, z)) return 'urban'
  if (route_surface(x, z, layout).distance < 10) return 'street'
  const terrace = layout.terraces.find((t) => terrace_distance(x, z, t) === 0)
  if (terrace) return terrace.land_use as ThebesLandUse
  return sample_world_column(world, x, z).surface_y <= world.recipe.sea_level ? 'water' : 'wild'
}
export const generate_thebes_sky_map = (world: CompiledWorld, city: CompiledCity): ThebesSkyMap => {
  const layout = thebes_layout(city),
    width = 96,
    depth = 96
  return {
    width,
    depth,
    uses: Array.from({ length: width * depth }, (_, index) =>
      land_use(
        world,
        layout,
        city.area.min_x + ((index % width) + 0.5) * 16,
        city.area.min_z + (Math.floor(index / width) + 0.5) * 16
      )
    ),
    street_paths: layout.routes.map((route) => route.map(([x, , z]) => [x, z] as const)),
    river_path: layout.river,
    castle_center: layout.castle,
  }
}
