// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Item facets derive availability from authored items, recipes, mob loot, and world placement.

import { item_categories, job_slugs, rare_pet_food_tier } from '@aresrpg/immutable'

import type { MobFilterRow } from './mob_filters.ts'
import { item_resource_kind, resource_kinds } from './resource_kind.ts'

export type ItemFilterGroup = 'category' | 'resource' | 'job' | 'world' | 'family'
export type ItemFilterRow = Readonly<{
  group: ItemFilterGroup
  kind: ItemFilterGroup | 'biome' | 'city'
  id: string
  parent?: string
  item_types: readonly string[]
}>

type FilterItem = Readonly<{ item_type: string; category: string }>
type FilterRecipe = Readonly<{ output_type: string; inputs: Readonly<Record<string, unknown>> }>
type FilterMob = Readonly<{ mob_type: string; loot: readonly Readonly<{ item_type: string }>[] }>
type FilterWorld = Readonly<{
  world: string
  terrain?: Readonly<{ biomes: readonly Readonly<{ name: string }>[] }>
  cities: readonly Readonly<{ city: string }>[]
  resources: readonly Readonly<{ item_type: string; biomes: readonly string[]; cities: readonly string[] }>[]
}>

const unique = (values: readonly string[]): readonly string[] => Object.freeze([...new Set(values)])

const row = (
  group: ItemFilterGroup,
  kind: ItemFilterRow['kind'],
  id: string,
  item_types: readonly string[],
  parent?: string
): ItemFilterRow => Object.freeze({ group, kind, id, ...(parent ? { parent } : {}), item_types: unique(item_types) })

const location_resources = (world: FilterWorld, kind: 'world' | 'biome' | 'city', place: string): readonly string[] => {
  if (kind === 'world') return world.resources.map(({ item_type }) => item_type)
  return world.resources.flatMap((resource) =>
    (kind === 'biome' ? resource.biomes : resource.cities).includes(place) ? [resource.item_type] : []
  )
}

export const derive_item_filter_rows = <Recipe extends FilterRecipe>(
  items: readonly FilterItem[],
  recipes: readonly Recipe[],
  recipe_job: (recipe: Recipe) => string,
  mobs: readonly FilterMob[],
  mob_filters: readonly MobFilterRow[],
  worlds: readonly FilterWorld[]
): readonly ItemFilterRow[] => {
  const recipe_outputs = new Set(recipes.map(({ output_type }) => output_type))
  const pet_food_outputs = new Set(
    recipes.flatMap((recipe) => (rare_pet_food_tier(Object.keys(recipe.inputs)) !== null ? [recipe.output_type] : []))
  )
  const mobs_by_type = new Map(mobs.map((mob) => [mob.mob_type, mob] as const))
  const loot_for = (mob_types: readonly string[]): readonly string[] =>
    mob_types.flatMap((mob_type) => mobs_by_type.get(mob_type)?.loot.map(({ item_type }) => item_type) ?? [])
  const categories = item_categories.flatMap((category) => {
    const matching = items.filter((item) => item.category === category).map(({ item_type }) => item_type)
    return matching.length ? [row('category', 'category', category, matching)] : []
  })
  const resources = resource_kinds.map((kind) =>
    row(
      'resource',
      'resource',
      kind,
      items.flatMap((item) =>
        item.category === 'resource' &&
        item_resource_kind(item.item_type, recipe_outputs.has(item.item_type), pet_food_outputs.has(item.item_type)) ===
          kind
          ? [item.item_type]
          : []
      )
    )
  )
  const jobs = job_slugs.flatMap((job) => {
    const outputs = recipes.filter((recipe) => recipe_job(recipe) === job).map(({ output_type }) => output_type)
    return outputs.length ? [row('job', 'job', job, outputs)] : []
  })
  const places = worlds.flatMap((world): readonly ItemFilterRow[] => {
    const locations = [
      { kind: 'world' as const, id: world.world, place: world.world },
      ...(world.terrain?.biomes.map(({ name }) => ({
        kind: 'biome' as const,
        id: `${world.world}:${name}`,
        place: name,
      })) ?? []),
      ...world.cities.map(({ city }) => ({ kind: 'city' as const, id: `${world.world}:${city}`, place: city })),
    ]
    return locations.flatMap(({ kind, id, place }) => {
      const mob_types = mob_filters.find((filter) => filter.kind === kind && filter.id === id)?.mob_types ?? []
      const item_types = [...loot_for(mob_types), ...location_resources(world, kind, place)]
      return item_types.length ? [row('world', kind, id, item_types, kind === 'world' ? undefined : world.world)] : []
    })
  })
  const families = mob_filters.flatMap((filter) =>
    filter.kind === 'family' ? [row('family', 'family', filter.id, loot_for(filter.mob_types))] : []
  )
  return Object.freeze(
    [...categories, ...resources, ...jobs, ...places, ...families].filter(({ item_types }) => item_types.length > 0)
  )
}

export const filter_item_types = (
  item_types: readonly string[],
  rows: readonly ItemFilterRow[],
  selected: Readonly<Partial<Record<ItemFilterGroup, string>>>
): readonly string[] => {
  const active = Object.entries(selected)
  return Object.freeze(
    item_types.filter((item_type) =>
      active.every(([group, id]) =>
        rows.find((candidate) => candidate.group === group && candidate.id === id)?.item_types.includes(item_type)
      )
    )
  )
}
