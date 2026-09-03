// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The canonical adapter from authored seed JSON to the SDK writer schema used by release validation.

import { parse_world_recipe, sample_biome_grid } from '@aresrpg/engine'
import { archimob_rows, gatherable_of, world_center, world_size } from '@aresrpg/immutable'
import { ZONE_SIZE } from '@aresrpg/protocol'
import type { SeedContent } from '@aresrpg/sdk/seed'

import airdrop_source from '../../../../seed/content/airdrop.json'
import boards_source from '../../../../seed/content/fight_boards.json'
import dungeons_source from '../../../../seed/content/dungeons.json'
import items_source from '../../../../seed/content/items.json'
import mobs_source from '../../../../seed/content/mobs.json'
import mastery_source from '../../../../seed/content/mastery.json'
import recipes_source from '../../../../seed/content/recipes.json'
import spells_source from '../../../../seed/content/spells.json'
import worlds_source from '../../../../seed/content/worlds.json'

const biome_maps: SeedContent['biome_maps'] = worlds_source.flatMap((world) => {
  if (!world.terrain) return []
  const grid = sample_biome_grid(parse_world_recipe(world.terrain), {
    world_size,
    world_center,
    cell_size: ZONE_SIZE,
  })
  return [
    Object.freeze({
      world: world.world,
      zone_x0: 0,
      zone_z0: 0,
      side: grid.side,
      cells: Object.freeze(Array.from(grid.cells)),
    }),
  ]
})

// Family is editor-only taxonomy. Strip it at the SDK boundary so changing a filter label
// cannot fingerprint or rewrite a chain MobTemplate.
const chain_mobs = Object.freeze(
  mobs_source.map((mob) => Object.freeze(Object.fromEntries(Object.entries(mob).filter(([key]) => key !== 'family'))))
)

const chain_worlds = Object.freeze(
  worlds_source.map((world) =>
    Object.freeze({
      ...world,
      archis: archimob_rows(
        mobs_source,
        world.mobs.map(({ mob_type }) => mob_type)
      ),
      cities: Object.freeze(world.cities.map(({ city, x, z, dungeon }) => Object.freeze({ city, x, z, dungeon }))),
      resources: Object.freeze(
        world.resources.map((resource) => {
          const gatherable = gatherable_of(resource.item_type)
          if (!gatherable) throw new Error(`Unknown gatherable ${resource.item_type} in ${world.world}`)
          return Object.freeze({
            ...gatherable,
            biomes: Object.freeze(resource.biomes),
            cities: Object.freeze('cities' in resource ? (resource.cities ?? []) : []),
          })
        })
      ),
    })
  )
)

const authored_content = Object.freeze({
  items: items_source,
  spells: spells_source,
  mobs: chain_mobs,
  recipes: recipes_source,
  dungeons: dungeons_source,
  worlds: chain_worlds,
  mastery: mastery_source,
  airdrop: Object.freeze({
    drops: airdrop_source.drops,
    giftcards: airdrop_source.giftcards,
  }),
  biome_maps: Object.freeze(biome_maps),
  boards: boards_source.boards,
})

// TypeScript widens JSON strings, so it cannot retain the immutable unions. The repository seed
// gate validates these exact eight imports before the bundle can ship; this is their one typed edge.
export const seed_content = authored_content as unknown as SeedContent
