// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import source from '../../../../../seed/scenes/thebes.recipe.json'
import type { CompiledCity } from '../types.ts'
import type { Vec3 } from '../../types.ts'

export const thebes_layout = (city: CompiledCity) => {
  const point = ([x, z]: readonly number[]): readonly [number, number] => [
    city.area.anchor_x + x!,
    city.area.anchor_z + z!,
  ]
  const position = ([x, y, z]: readonly number[]): Vec3 => [city.area.anchor_x + x!, y!, city.area.anchor_z + z!]
  return {
    city: [city.area.anchor_x, city.area.anchor_z] as const,
    cemetery_entry: point(source.cemetery_entry),
    farmhouse: point(source.farmhouse),
    arrival: point(source.arrival),
    gateway: point(source.gateway),
    castle: point(source.castle),
    keep_height: source.castle[2]! + source.keep_rise,
    cathedral: point(source.cathedral),
    reserved_plots: source.reserved_plots.map(([x0, x1, z0, z1]) => ({
      min_x: point([x0!, z0!])[0],
      max_x: point([x1!, z1!])[0],
      min_z: point([x0!, z0!])[1],
      max_z: point([x1!, z1!])[1],
    })),
    terraces: source.terraces.map(({ id, bounds: [x0, x1, z0, z1], height, land_use, rounding }) => ({
      id,
      min_x: point([x0!, z0!])[0],
      max_x: point([x1!, z1!])[0],
      min_z: point([x0!, z0!])[1],
      max_z: point([x1!, z1!])[1],
      height,
      land_use,
      rounding,
    })),
    routes: source.routes.map((route) => route.map(position)),
    river: source.river.map(point),
    river_widths: source.river.map(([, , width]) => width!),
    coastal_relic: point(source.coastal_relic),
    bridges: source.bridges.map((bridge) => ({ ...bridge, start: position(bridge.start), end: position(bridge.end) })),
    mountains: source.mountains.map(([x, z, radius, height]) => ({
      center: point([x!, z!]),
      radius: radius!,
      height: height!,
    })),
    tree_materials: source.tree_materials,
    trees: source.trees.map((tree) => ({ ...tree, position: point(tree.position) })),
  }
}
export type ThebesLayout = ReturnType<typeof thebes_layout>

export const in_reserved_plot = (layout: ThebesLayout, x: number, z: number): boolean =>
  layout.reserved_plots.some((plot) => x >= plot.min_x && x <= plot.max_x && z >= plot.min_z && z <= plot.max_z)
