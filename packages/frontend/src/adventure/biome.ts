// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  BIOME_SLOTS,
  landscape_height,
  compile_runtime_world_recipe,
  create_fbm_sampler,
  parse_world_recipe,
  sample_world_column,
  world_terrain,
  type TerrainHeightGrid,
  type WorldRecipe,
} from '@aresrpg/engine'

import environment from '../../../../seed/content/adventure_environment.json'

const relief = create_fbm_sampler(1934, { period: 64, octaves: 3, gain: 0.5 })
const path_center = environment.path.center.map(([x, y]) => [x!, y!] as const)
export const adventure_axis = (z: number): number => landscape_height(path_center, z)

export const RIVER_CENTER_Z = 211
export const BRIDGE_HEIGHT = 80

const forest_recipe = (): WorldRecipe => {
  const source = parse_world_recipe(world_terrain('nauvis'))
  const { ocean: _ocean, ...land } = source
  return parse_world_recipe({
    ...land,
    sea_level: environment.sea_level,
    structure_areas: [],
    materials: { ...source.materials, ...environment.materials },
    scenery: environment.scenery,
    atmosphere: environment.atmosphere,
    canopy: environment.canopy,
    biome_slots: Object.fromEntries(BIOME_SLOTS.map((slot) => [slot, 'mosswood'])) as WorldRecipe['biome_slots'],
    biomes: [
      {
        name: 'mosswood',
        structure_packs: ['temperate_trees', 'temperate_rocks'],
        ravines: true,
        mountain_passes: true,
        landscape: [
          { x: 0, y: 40, land: { surface: 'moss', subsurface: 'rich_soil', filler: 'stone' } },
          { x: 0.2, y: 54 },
          { x: 0.4, y: 62 },
          { x: 0.6, y: 72 },
          { x: 0.7, y: 80 },
          { x: 0.76, y: 108 },
          { x: 0.82, y: 156 },
          { x: 0.9, y: 225 },
          { x: 1, y: 310 },
        ],
      },
    ],
  })
}

/** A continuous height field owns the canyon, mesas and walkable approach in every renderer. */
const valley_height = (x: number, z: number): number => {
  const variation = (relief(x, z) - 0.5) * 2
  const terraces = environment.terraces.map((terrace) => {
    const distance = Math.hypot((x - terrace.x) / terrace.radius_x, (z - terrace.z) / terrace.radius_z)
    const edge = Math.max(0, Math.min(1, (1 - distance + variation * 0.05) * 6))
    return environment.sea_level - 2 + (terrace.height + variation * terrace.relief - environment.sea_level + 2) * edge
  })
  const route_width = z < 142 ? 33 : 4
  const route = Math.max(0, Math.min(1, (route_width - Math.abs(x - adventure_axis(z))) / 4))
  const approach = z < 280 ? (z < 180 ? 72 : BRIDGE_HEIGHT - 1) * route : 0
  return Math.max(environment.sea_level - 2, approach, ...terraces)
}

export const adventure_biome = (): WorldRecipe => {
  const recipe = forest_recipe()
  const world = compile_runtime_world_recipe(recipe)
  const cell_size = 4
  const width = 208
  const depth = 192
  const target_heights = Array.from({ length: width * depth }, (_, index) => {
    const x = -288 + ((index % width) + 0.5) * cell_size
    const z = 80 + (Math.floor(index / width) + 0.5) * cell_size
    const surface = sample_world_column(world, x, z).surface_y
    const edge = Math.min((x + 288) / 64, (544 - x) / 64, (848 - z) / 80, (z - 80) / 16, 1)
    return Math.round(surface + (valley_height(x, z) - surface) * Math.max(0, edge))
  })
  const height_grid: TerrainHeightGrid = {
    min_x: -288,
    min_z: 80,
    cell_size,
    width,
    depth,
    target_heights,
    cut_cells: [],
  }
  return { ...recipe, height_grid }
}
