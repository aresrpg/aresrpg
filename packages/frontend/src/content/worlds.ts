// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The single frontend import boundary for the engine-owned world projection.

import {
  compile_runtime_world_recipe,
  parse_world_recipe,
  sample_biome_cell,
  worlds_source,
  type CompiledWorld,
} from '@aresrpg/engine'
import { world_center } from '@aresrpg/immutable'
import { ZONE_SIZE } from '@aresrpg/protocol'

export {
  city_at_position,
  client_world_position,
  world_city_areas,
  world_terrain,
  worlds_source,
} from '@aresrpg/engine'
export type { WorldCityArea as ClientCityArea } from '@aresrpg/engine'

const biome_worlds = new Map<string, CompiledWorld>()

/** The exact published biome-map value for one zone, compiled lazily from authored terrain. */
export const world_biome_at_zone = (world_name: string, zone_x: number, zone_z: number): string | null => {
  const source = worlds_source.find(({ world }) => world === world_name)
  if (!source?.terrain) return null
  const world =
    biome_worlds.get(world_name) ??
    compile_runtime_world_recipe(parse_world_recipe(source.terrain), { structures: false })
  if (!biome_worlds.has(world_name)) biome_worlds.set(world_name, world)
  const biome = sample_biome_cell(world, zone_x, zone_z, { world_center, cell_size: ZONE_SIZE })
  return world.biomes[biome]?.name ?? null
}
