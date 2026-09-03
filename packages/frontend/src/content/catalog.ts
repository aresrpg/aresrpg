// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One seed-derived content projection shared by every frontend feature.

import {
  acquisition_average_seconds,
  acquisition_estimator,
  best_recipe_for_job_progression,
  class_names,
  craft_job_of,
  craft_xp_from_ingredient_count,
  gatherable_of,
  item_stat_center,
  job_slugs,
  rune_effect,
  tier_unlock_level,
  type GatheringJob,
  type JobSlug,
  type AcquisitionContent,
  type RecipeProgressRecommendation,
  type StatName,
} from '@aresrpg/immutable'
import type {
  SeedConsumable as ConsumableEffect,
  SeedEffect as SpellEffect,
  SeedItem,
  SeedMob,
  SeedRecipe,
  SeedSpell,
  SeedSpellLevel as SpellLevel,
} from '@aresrpg/sdk/seed'
import type { WorldMaterial } from '@aresrpg/engine'

import items_source from '../../../../seed/content/items.json'
import mastery_source from '../../../../seed/content/mastery.json'
import mobs_source from '../../../../seed/content/mobs.json'
import recipes_source from '../../../../seed/content/recipes.json'
import airdrop_source from '../../../../seed/content/airdrop.json'
import spells_source from '../../../../seed/content/spells.json'
import dungeons_source from '../../../../seed/content/dungeons.json'

import { worlds_source } from './worlds.ts'
import { derive_item_filter_rows } from './item_filters.ts'
import { derive_mob_filter_rows } from './mob_filters.ts'

type AirdropSource = Readonly<{
  drops: readonly Readonly<{ id: string; item_type: string; amount_each: number; whitelist: readonly string[] }>[]
  giftcards: readonly Readonly<{ id: string; item_type: string; amount: number; custody: string }>[]
  showcase: readonly Readonly<{
    id: string
    kind: string
    name: string
    art: Readonly<{ glb?: string; icon?: string }>
    art_status: Readonly<{ glb?: string; icon?: string }>
    aura?: Readonly<{ color: string; status: string }>
    aura_pending?: boolean
  }>[]
  legacy_pool: readonly Readonly<Record<string, unknown>>[]
  pending: readonly Readonly<{ id: string; name: string }>[]
}>
type MasterySource = Readonly<{
  offers: readonly Readonly<{ item_type: string; cost: number; enabled?: boolean }>[]
}>

const authored_airdrop = airdrop_source as unknown as AirdropSource
const authored_mastery = mastery_source as unknown as MasterySource

export type StatBlock = Readonly<Record<StatName, number>>

export type { ConsumableEffect, SeedItem, SeedMob, SeedRecipe, SeedSpell, SpellEffect, SpellLevel }
export type LootRow = SeedMob['loot'][number]

export type WorldResource = Readonly<{
  item_type: string
  job: GatheringJob
  tier: number
  protector: string
  rare_item_type: string
  biomes: readonly string[]
  cities: readonly string[]
}>

export type WorldMob = Readonly<{
  mob_type: string
  weight_bp: number
  biomes: readonly string[]
  cities: readonly string[]
}>

export type WorldCity = Readonly<{ city: string; x: number; z: number; dungeon: string }>

export type SeedDungeon = Readonly<{
  dungeon: string
  key: string
  rooms: readonly (readonly Readonly<{ mob_type: string }>[])[]
}>

export type SeedWorld = Readonly<{
  world: string
  entry_level: number
  terrain?: Readonly<{
    seed: string
    sea_level: number
    materials: Readonly<Record<string, WorldMaterial>>
    biomes: readonly Readonly<{
      name: string
      climate: Readonly<Record<string, number>>
      weight: number
      land: Readonly<Record<string, string>>
    }>[]
  }>
  mobs: readonly WorldMob[]
  resources: readonly WorldResource[]
  cities: readonly WorldCity[]
}>

type RawSeedWorld = Omit<SeedWorld, 'mobs' | 'resources'> &
  Readonly<{
    mobs:
      | readonly Readonly<{
          mob_type: string
          weight_bp: number
          biomes: readonly string[]
          cities?: readonly string[]
        }>[]
      | Readonly<Record<string, number>>
    resources: readonly Readonly<{
      item_type: string
      biomes?: readonly string[]
      cities?: readonly string[]
    }>[]
  }>

const items = Object.freeze(items_source as unknown as readonly SeedItem[])
const mobs = Object.freeze(mobs_source as unknown as readonly SeedMob[])
const recipes = Object.freeze(recipes_source as unknown as readonly SeedRecipe[])
const spells = Object.freeze(spells_source as unknown as readonly SeedSpell[])
const dungeons = Object.freeze(dungeons_source as unknown as readonly SeedDungeon[])
const worlds = Object.freeze(
  (worlds_source as unknown as readonly RawSeedWorld[]).map((world) =>
    Object.freeze({
      ...world,
      mobs: Object.freeze(
        Array.isArray(world.mobs)
          ? world.mobs.map((mob) => Object.freeze({ ...mob, cities: Object.freeze(mob.cities ?? []) }))
          : Object.entries(world.mobs).map(([mob_type, weight_bp]) =>
              Object.freeze({ mob_type, weight_bp, biomes: Object.freeze([]), cities: Object.freeze([]) })
            )
      ),
      resources: Object.freeze(
        world.resources.map((resource) => {
          const gatherable = gatherable_of(resource.item_type)
          if (!gatherable) throw new Error(`Unknown gatherable ${resource.item_type} in ${world.world}`)
          return Object.freeze({
            ...gatherable,
            biomes: Object.freeze(resource.biomes ?? []),
            cities: Object.freeze(resource.cities ?? []),
          })
        })
      ),
    })
  )
)

const keyed = <T>(rows: readonly T[], key: (row: T) => string): Readonly<Record<string, T>> =>
  Object.freeze(Object.fromEntries(rows.map((row) => [key(row), row])))

const group_entries = <T>(entries: readonly (readonly [string, T])[]): Readonly<Record<string, readonly T[]>> => {
  const grouped = new Map<string, T[]>()
  for (const [key, value] of entries) {
    const rows = grouped.get(key)
    if (rows) {
      // eslint-disable-next-line functional/immutable-data -- local construction owns the fresh bucket and freezes it before publication
      rows.push(value)
    } else {
      grouped.set(key, [value])
    }
  }
  return Object.freeze(Object.fromEntries([...grouped].map(([key, rows]) => [key, Object.freeze(rows)])))
}

const items_by_type = keyed(items, ({ item_type }) => item_type)
const mobs_by_type = keyed(mobs, ({ mob_type }) => mob_type)
const recipes_by_output = keyed(recipes, ({ output_type }) => output_type)
const dungeons_by_id = keyed(dungeons, ({ dungeon }) => dungeon)
const dungeon_mob_types = (dungeon: string): readonly string[] =>
  Object.freeze(dungeons_by_id[dungeon]?.rooms.flatMap((room) => room.map(({ mob_type }) => mob_type)) ?? [])
const recipe_job = (recipe: SeedRecipe): string =>
  craft_job_of(items_by_type[recipe.output_type]?.category ?? '') ?? recipe.job ?? ''
const acquisition = acquisition_estimator({
  items,
  recipes,
  mobs,
  worlds,
  dungeons,
  spells,
} as unknown as AcquisitionContent)
const progression_recipes = Object.freeze(
  recipes.map((recipe) => Object.freeze({ ...recipe, job: recipe_job(recipe) }))
)
const progress_recipe = (job: JobSlug, level: number): RecipeProgressRecommendation | null =>
  best_recipe_for_job_progression(progression_recipes, job, level, (item_type) => {
    const estimate = acquisition(item_type).best
    return estimate ? acquisition_average_seconds(estimate) : null
  })

const ingredient_recipes = group_entries(
  recipes.flatMap((recipe) => Object.keys(recipe.inputs).map((item_type) => [item_type, recipe] as const))
)
const drops = group_entries(
  mobs.flatMap((mob) => mob.loot.map((drop) => [drop.item_type, Object.freeze({ mob, drop })] as const))
)
const mob_worlds = group_entries(
  worlds.flatMap((world) =>
    [
      ...new Set([
        ...world.mobs.map(({ mob_type }) => mob_type),
        ...world.resources.map(({ protector }) => protector),
        ...world.cities.flatMap(({ dungeon }) => dungeon_mob_types(dungeon)),
      ]),
    ].map((mob_type) => [mob_type, world] as const)
  )
)
const item_worlds = group_entries(
  worlds.flatMap((world) => world.resources.map(({ item_type }) => [item_type, world] as const))
)

export type ItemDetail = Readonly<{
  item: SeedItem
  rune: ReturnType<typeof rune_effect>
  pet_foods: readonly SeedItem[]
  recipe: Readonly<{
    job: string
    craft_xp: number
    ingredients: readonly Readonly<{ item_type: string; quantity: number; item: SeedItem | null }>[]
  }> | null
  ingredient_of: readonly Readonly<{ recipe: SeedRecipe; output: SeedItem | null }>[]
  dropped_by: readonly Readonly<{ mob: SeedMob; drop: LootRow }>[]
  worlds: readonly SeedWorld[]
}>

const item = (item_type: string): ItemDetail | null => {
  const row = items_by_type[item_type]
  if (!row) return null
  const recipe = recipes_by_output[item_type]
  return Object.freeze({
    item: row,
    rune: rune_effect(row.item_type),
    pet_foods: Object.freeze((row.pet_foods ?? []).flatMap((food_type) => items_by_type[food_type] ?? [])),
    recipe: recipe
      ? Object.freeze({
          job: recipe_job(recipe),
          craft_xp: craft_xp_from_ingredient_count(Object.keys(recipe.inputs).length),
          ingredients: Object.freeze(
            Object.entries(recipe.inputs).map(([input_type, quantity]) =>
              Object.freeze({ item_type: input_type, quantity, item: items_by_type[input_type] ?? null })
            )
          ),
        })
      : null,
    ingredient_of: Object.freeze(
      (ingredient_recipes[item_type] ?? []).map((ingredient_recipe) =>
        Object.freeze({ recipe: ingredient_recipe, output: items_by_type[ingredient_recipe.output_type] ?? null })
      )
    ),
    dropped_by: drops[item_type] ?? Object.freeze([]),
    worlds: item_worlds[item_type] ?? Object.freeze([]),
  })
}

export type MobDetail = Readonly<{
  mob: SeedMob
  loot: readonly Readonly<{ drop: LootRow; item: SeedItem | null }>[]
  worlds: readonly SeedWorld[]
}>

const mob = (mob_type: string): MobDetail | null => {
  const row = mobs_by_type[mob_type]
  return row
    ? Object.freeze({
        mob: row,
        loot: Object.freeze(
          row.loot.map((drop) => Object.freeze({ drop, item: items_by_type[drop.item_type] ?? null }))
        ),
        worlds: mob_worlds[mob_type] ?? Object.freeze([]),
      })
    : null
}

export type ClassDetail = Readonly<{ id: string; spells: readonly SeedSpell[] }>

const classes = Object.freeze(
  class_names.map((id) => Object.freeze({ id, spells: Object.freeze(spells.filter(({ classe }) => classe === id)) }))
)
const classes_by_id = keyed(classes, ({ id }) => id)

export type JobDetail = Readonly<{
  id: JobSlug
  recipes: readonly SeedRecipe[]
  resources: readonly Readonly<{ row: WorldResource; worlds: readonly SeedWorld[]; required_level: number }>[]
}>

const jobs = Object.freeze(
  job_slugs.map((id) => {
    const resource_types = new Set(
      worlds.flatMap(({ resources }) => resources.filter(({ job }) => job === id).map(({ item_type }) => item_type))
    )
    return Object.freeze({
      id,
      recipes: Object.freeze(recipes.filter((recipe) => recipe_job(recipe) === id)),
      resources: Object.freeze(
        [...resource_types].map((item_type) => {
          const resource_worlds = worlds.filter(({ resources }) =>
            resources.some((row) => row.job === id && row.item_type === item_type)
          )
          const row = resource_worlds[0]!.resources.find((resource) => resource.item_type === item_type)!
          return Object.freeze({
            row,
            worlds: Object.freeze(resource_worlds),
            required_level: tier_unlock_level(row.tier),
          })
        })
      ),
    })
  })
)
const jobs_by_id = keyed(jobs, ({ id }) => id)
const worlds_by_id = keyed(worlds, ({ world }) => world)
const mob_filters = derive_mob_filter_rows(
  mobs,
  worlds.map((world) =>
    Object.freeze({
      world: world.world,
      biome_names: Object.freeze(world.terrain?.biomes.map(({ name }) => name) ?? []),
      mobs: world.mobs,
      protectors: Object.freeze(
        world.resources.map(({ protector, biomes }) => Object.freeze({ mob_type: protector, biomes }))
      ),
      cities: Object.freeze(
        world.cities.map(({ city, dungeon }) => Object.freeze({ city, mob_types: dungeon_mob_types(dungeon) }))
      ),
    })
  )
)
const item_filters = derive_item_filter_rows(items, recipes, recipe_job, mobs, mob_filters, worlds)

const mastery_offers = Object.freeze(
  authored_mastery.offers.map((offer) =>
    Object.freeze({
      ...offer,
      item: items_by_type[offer.item_type] ?? null,
    })
  )
)
const airdrop_drops = Object.freeze(
  authored_airdrop.drops.map((drop) =>
    Object.freeze({
      ...drop,
      item: items_by_type[drop.item_type] ?? null,
    })
  )
)

export const content_catalog = Object.freeze({
  items,
  mobs,
  recipes,
  spells,
  dungeons,
  worlds,
  mob_filters,
  item_filters,
  classes,
  jobs,
  mastery: Object.freeze({ offers: mastery_offers }),
  airdrop: Object.freeze({
    drops: airdrop_drops,
    giftcards: Object.freeze(authored_airdrop.giftcards),
    showcase: Object.freeze(authored_airdrop.showcase),
    legacy_pool: Object.freeze(authored_airdrop.legacy_pool),
    pending: Object.freeze(authored_airdrop.pending),
  }),
  item,
  mob,
  class: (id: string): ClassDetail | null => classes_by_id[id] ?? null,
  job: (id: string): JobDetail | null => jobs_by_id[id] ?? null,
  world: (id: string): SeedWorld | null => worlds_by_id[id] ?? null,
  dungeon: (id: string): SeedDungeon | null => dungeons_by_id[id] ?? null,
  progress_recipe,
})

export { content_catalog as encyclopedia_catalog }

export const centered_resistance = (value: number): number => value - item_stat_center

export const titleize = (value: string): string =>
  value
    .replace(/^\d+_/, '')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())

export const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
