// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Every number a guide states is derived here from the game's own content and constants.
import { basis_points, marketplace_lot_sizes, marketplace_royalty_bps } from '@aresrpg/immutable'
import { CHARACTER_PRICE_MIST } from '@aresrpg/sdk/character-price'
import { ROYALTY_FLOOR_MIST } from '@aresrpg/sdk/marketplace'

import { content_catalog, type ItemDetail, type SeedItem, type SeedMob } from '../content/catalog.ts'

const MIST_PER_SUI = 1_000_000_000

export const docs_counts = Object.freeze({
  items: content_catalog.items.length,
  spells: content_catalog.spells.length,
  mobs: content_catalog.mobs.length,
  recipes: content_catalog.recipes.length,
  classes: content_catalog.classes.length,
  jobs: content_catalog.jobs.length,
})

export const character_price_sui = Number(CHARACTER_PRICE_MIST) / MIST_PER_SUI

export const market_terms = Object.freeze({
  royalty_percent: (marketplace_royalty_bps / basis_points) * 100,
  royalty_floor_sui: Number(ROYALTY_FLOOR_MIST) / MIST_PER_SUI,
  lot_sizes: marketplace_lot_sizes,
})

const by_level = (left: Readonly<{ level_min: number }>, right: Readonly<{ level_min: number }>): number =>
  left.level_min - right.level_min

/** The first city of the lowest-entry world, with the mobs that roam it. */
const starter = (() => {
  const [world] = content_catalog.worlds.toSorted((left, right) => left.entry_level - right.entry_level)
  const [city] = world?.cities ?? []
  if (!world || !city) return null
  const mobs = world.mobs
    .filter(({ cities }) => cities.includes(city.city))
    .flatMap(({ mob_type }) => content_catalog.mob(mob_type)?.mob ?? [])
    .toSorted(by_level)
  return Object.freeze({ world: world.world, city: city.city, dungeon: city.dungeon, mobs: Object.freeze(mobs) })
})()

export type PartSource = Readonly<{ item: SeedItem; quantity: number; mob: SeedMob | null; chance_bp: number }>
export type FirstTool = Readonly<{ item: SeedItem; job: string; parts: readonly PartSource[] }>

/** The best mob to hunt for an item: a starter-city mob when one drops it, else the highest chance anywhere. */
const best_drop = (detail: ItemDetail | null): Readonly<{ mob: SeedMob; chance_bp: number }> | null => {
  const sources = detail?.dropped_by ?? []
  const nearby = sources.filter(({ mob }) => starter?.mobs.includes(mob))
  const [best] = (nearby.length ? nearby : sources).toSorted(
    (left, right) => right.drop.chance_bp - left.drop.chance_bp
  )
  return best ? { mob: best.mob, chance_bp: best.drop.chance_bp } : null
}

const part_source = ({
  item,
  item_type,
  quantity,
}: NonNullable<ItemDetail['recipe']>['ingredients'][number]): readonly PartSource[] => {
  if (!item) return []
  const source = best_drop(content_catalog.item(item_type))
  return [{ item, quantity, mob: source?.mob ?? null, chance_bp: source?.chance_bp ?? 0 }]
}

/** The lowest-level craftable farming tool, and the best mob to hunt for each of its parts. */
const first_tool = ((): FirstTool | null => {
  const [tool] = content_catalog.items
    .filter(({ category }) => category === 'tool_farmer')
    .flatMap(({ item_type }) => content_catalog.item(item_type) ?? [])
    .filter(({ recipe }) => recipe !== null)
    .toSorted((left, right) => left.item.level - right.item.level)
  if (!tool?.recipe) return null
  return Object.freeze({
    item: tool.item,
    job: tool.recipe.job,
    parts: Object.freeze(tool.recipe.ingredients.flatMap(part_source)),
  })
})()

const first_key = ((): SeedItem | null => {
  const key = starter ? content_catalog.dungeon(starter.dungeon)?.key : undefined
  return key ? (content_catalog.item(key)?.item ?? null) : null
})()

export const first_hour = Object.freeze({ starter, tool: first_tool, key: first_key })
