// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import arrival from '../seed/structures/thebes_arrival.recipe.json' with { type: 'json' }
import farmstead from '../seed/structures/thebes_farmstead.recipe.json' with { type: 'json' }
import gate from '../seed/structures/thebes_gate.recipe.json' with { type: 'json' }
import street from '../seed/structures/thebes_entry_street.recipe.json' with { type: 'json' }
import ward from '../seed/structures/thebes_castle_ward.recipe.json' with { type: 'json' }
import castle from '../seed/structures/thebes_castle.recipe.json' with { type: 'json' }
import left_bank from '../seed/structures/thebes_left_bank.recipe.json' with { type: 'json' }
import workshop from '../seed/structures/workshop.recipe.json' with { type: 'json' }
import { city_blocks, compile_city_structure } from '../packages/engine/src/cities/city_structure.ts'
import { thebes_layout } from '../packages/engine/src/cities/thebes/plan.ts'
import { thebes_city_terrain } from '../packages/engine/src/cities/thebes/sky_map.ts'
import { compile_world_recipe, sample_world_column } from '../packages/engine/src/world_recipe.ts'
import { CHUNK_EDGE } from '../packages/engine/src/voxel_data.ts'

import { partition_blocks } from './partition_blocks.mjs'
import { bake_city_instances } from './bake_city_instances.mjs'
import { bake_schematic } from './bake_schematic.mjs'

const bake_asset = (world, source, position, details) => {
  const [x, z] = position
  const y = sample_world_column(world, x, z).surface_y
  const material = (name) => source.palette[name] ?? name
  const assets = Object.fromEntries(
    Object.entries({ ...workshop.assets, ...source.assets }).map(([name, asset]) => [
      name,
      {
        ...asset,
        pieces: (asset.pieces ?? []).map(([shape, position, kind, ...rest]) => [
          shape,
          position,
          material(kind),
          ...rest,
        ]),
        ...(asset.details && {
          details: asset.details.map((operation) => [...operation.slice(0, -1), material(operation.at(-1))]),
        }),
      },
    ])
  )
  const root = assets[source.root]
  const components = [
    { ...root, parts: [], connections: [] },
    ...(root.parts ?? []).map((part) => ({ kind: 'building', parts: [part] })),
  ]
  const excavation = city_blocks()
  for (const { min, max } of source.excavations ?? [])
    excavation.fill(x + min[0], x + max[0], y + min[1], y + max[1], z + min[2], z + max[2], 'air')
  const blocks = components.flatMap((component) => {
    const baked = bake_schematic({ ...assets, component }, 'component', [x, y, z], details)
    if (baked.plants.length + baked.vines.length + baked.fires.length)
      throw new Error('Authored scenery must use existing world scenery ownership, not disappear during city baking')
    return baked.blocks
  })
  return partition_blocks([
    ...excavation.finish(),
    ...blocks,
    ...bake_city_instances(world, assets, position, source.instances ?? []),
  ]).map(({ origin, blocks }, index) => ({
    id: `city:thebes:36-authored-${source.name}:${index}`,
    x: origin[0],
    y: origin[1],
    z: origin[2],
    rotation: 0,
    type: compile_city_structure(
      { name: source.name, size: [CHUNK_EDGE, CHUNK_EDGE, CHUNK_EDGE], anchor: [0, 0, 0], blocks },
      world.materials
    ),
  }))
}

/** Authored landmarks share the strict workshop baker and the city's existing artifact and detail builder. */
export const bake_thebes_assets = (base, city, details) => {
  const terrain = thebes_city_terrain(base, city)
  const world = compile_world_recipe({ ...base.recipe, height_grid: terrain }, { city_terrain: false })
  const layout = thebes_layout(city)
  return [arrival, farmstead, gate, street, left_bank, castle, ward].flatMap((source) =>
    bake_asset(world, source, layout[source.anchor], details)
  )
}
