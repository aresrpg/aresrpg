// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { compile_world_recipe, sample_world_column, type CompiledWorld } from '../../world_recipe.ts'
import type { CityMapStructure, CityPlacementDraft, CompiledCity } from '../types.ts'
import type { PositionedCityStructure } from '../city_structure.ts'
import { detail_builder } from '../../detail_builder.ts'

import { dress_thebes } from './ornaments.ts'
import { thebes_layout } from './plan.ts'
import { generate_thebes_sky_map, thebes_city_terrain } from './sky_map.ts'
import { build_thebes_sublevels } from './structures/sublevels.ts'
import { build_thebes_rural } from './structures/rural.ts'
import { build_thebes_estuary } from './structures/estuary.ts'
import { build_thebes_landscape } from './structures/landscape.ts'
import { build_thebes_paths } from './structures/road.ts'
import { build_thebes_waterways } from './structures/waterway.ts'

export const terrain_thebes = thebes_city_terrain
const fixture = (world: CompiledWorld, city: CompiledCity) => {
  const terrain = thebes_city_terrain(world, city)
  return {
    world: compile_world_recipe({ ...world.recipe, height_grid: terrain }, { city_terrain: false }),
    layout: thebes_layout(city),
    sky: generate_thebes_sky_map(world, city),
  }
}
const drafts = (structures: readonly PositionedCityStructure[], prefix: string): readonly CityPlacementDraft[] =>
  structures.map((s, index) => ({
    id: `city:thebes:${prefix}:${String(index).padStart(4, '0')}`,
    type: s.type,
    x: s.x,
    y: s.y,
    z: s.z,
    rotation: 0,
  }))

export const plan_thebes = (
  base: CompiledWorld,
  city: CompiledCity,
  details = detail_builder()
): readonly CityPlacementDraft[] => {
  const { world, layout, sky } = fixture(base, city)
  dress_thebes(details, layout)
  const surface = (x: number, z: number) => sample_world_column(world, x, z).surface_y
  const roads = sky.street_paths.flatMap((path, index) =>
    path.slice(1).flatMap((end, segment) => {
      const built = build_thebes_paths(world, [[path[segment]!, end]], `thebes_street_${index}_${segment}`, surface)
      return built ? [built] : []
    })
  )
  return [
    ...drafts(build_thebes_landscape(world, city, sky, surface), '00-ground'),
    ...drafts(roads, '10-streets'),
    ...drafts(build_thebes_rural(world, city, sky), '70-parks'),
    ...drafts(build_thebes_estuary(world, layout), '80-estuary'),
    ...drafts(build_thebes_waterways(world, layout), '90-bridges'),
    ...drafts(build_thebes_sublevels(world, city), '99-catacombs'),
  ]
}

export const map_thebes = (world: CompiledWorld, city: CompiledCity): readonly CityMapStructure[] => {
  const sky = generate_thebes_sky_map(world, city),
    layout = thebes_layout(city)
  // Unmanaged land needs no overlay row; absence already means the city's default nature policy.
  const rows = sky.uses.flatMap((use, index) => {
    if (use === 'wild' || use === 'water') return []
    return [
      {
        id: `thebes:land:${index}`,
        type: `thebes_${use}`,
        min_x: city.area.min_x + (index % sky.width) * 16,
        max_x: city.area.min_x + (index % sky.width) * 16 + 15,
        min_z: city.area.min_z + Math.floor(index / sky.width) * 16,
        max_z: city.area.min_z + Math.floor(index / sky.width) * 16 + 15,
      },
    ]
  })
  const landmark = (id: string, type: string, x: number, z: number, rx: number, rz: number): CityMapStructure => ({
    id,
    type,
    min_x: x - rx,
    max_x: x + rx,
    min_z: z - rz,
    max_z: z + rz,
  })
  return [
    ...rows,
    ...layout.bridges.map(({ id, start, end, width }) =>
      landmark(
        id,
        'thebes_bridge',
        start[0],
        (start[2] + end[2]) / 2,
        Math.floor(width / 2),
        Math.abs(end[2] - start[2]) / 2
      )
    ),
    landmark('farmstead', 'thebes_farmstead', layout.farmhouse[0] + 4, layout.farmhouse[1], 18, 22),
    landmark('gateway', 'thebes_gate', ...layout.gateway, 12, 34),
    landmark('cathedral', 'thebes_temple', ...layout.cathedral, 24, 34),
    landmark('citadel', 'thebes_castle', ...layout.castle, 74, 74),
    landmark('square', 'thebes_dungeon_plaza', city.area.anchor_x, city.area.anchor_z, 22, 22),
    landmark('catacombs', 'thebes_catacombs', city.area.anchor_x, city.area.anchor_z, 68, 68),
  ]
}
