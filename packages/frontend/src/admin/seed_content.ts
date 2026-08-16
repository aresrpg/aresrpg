// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The admin publisher's one adapter from authored seed JSON to the SDK writer schema.

import { parse_world_recipe, sample_biome_grid } from '@aresrpg/engine'
import { world_center, world_size } from '@aresrpg/immutable'
import { ZONE_SIZE } from '@aresrpg/protocol'
import type { SeedContent } from '@aresrpg/sdk/seed'

import airdrop_source from '../../../../seed/content/airdrop.json'
import items_source from '../../../../seed/content/items.json'
import mobs_source from '../../../../seed/content/mobs.json'
import recipes_source from '../../../../seed/content/recipes.json'
import shop_source from '../../../../seed/content/shop.json'
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

const authored_content = Object.freeze({
  items: items_source,
  spells: spells_source,
  mobs: mobs_source,
  recipes: recipes_source,
  worlds: worlds_source,
  shop: shop_source,
  airdrop: Object.freeze({
    drops: airdrop_source.drops,
    giftcards: airdrop_source.giftcards,
  }),
  biome_maps: Object.freeze(biome_maps),
})

// TypeScript widens JSON strings, so it cannot retain the immutable unions. The repository seed
// gate validates these exact seven imports before the bundle can ship; this is their one typed edge.
export const seed_content = authored_content as unknown as SeedContent
