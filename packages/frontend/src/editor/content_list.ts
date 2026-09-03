// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  class_names,
  craft_job_of,
  gatherable_catalog,
  rare_pet_food_tier,
  item_categories,
  job_groups,
  job_slugs,
} from '@aresrpg/immutable'

import {
  derive_mob_filter_rows,
  type MobFilterRow,
  type MobFilterSource,
  type MobFilterWorldSource,
} from '../content/mob_filters.ts'
import { item_resource_kind, resource_kinds } from '../content/resource_kind.ts'

import { seed_content_domains, type JsonValue, type SeedDomain, type SeedEntityRow } from './seed_editor.ts'

export type { MobFilterRow } from '../content/mob_filters.ts'

export const content_navigation_domains = seed_content_domains.filter(
  ({ id }) => id !== 'worlds' && id !== 'recipes' && id !== 'fight_boards'
)

const record_value = (value: JsonValue | undefined): Readonly<Record<string, JsonValue>> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, JsonValue>>)
    : null

const number_field = (row: SeedEntityRow, field: string): number => {
  const value = record_value(row.value)?.[field]
  return typeof value === 'number' ? value : 0
}

export const content_row_category = (row: SeedEntityRow): string => {
  const category = record_value(row.value)?.category
  return typeof category === 'string' ? category : ''
}

export const content_row_classe = (row: SeedEntityRow): string => {
  const classe = record_value(row.value)?.classe
  return typeof classe === 'string' ? classe : ''
}

export const spell_row_has_effects = (row: SeedEntityRow): boolean => {
  const levels = record_value(row.value)?.levels
  if (!Array.isArray(levels)) return false
  return levels.some((level) => {
    const spell_level = record_value(level)
    return (
      (Array.isArray(spell_level?.effects) && spell_level.effects.length > 0) ||
      (Array.isArray(spell_level?.crit_effects) && spell_level.crit_effects.length > 0)
    )
  })
}

export const content_row_level = (domain: SeedDomain, row: SeedEntityRow): number | null => {
  if (domain === 'items') return number_field(row, 'level')
  if (domain === 'spells') return number_field(row, 'unlock_level')
  if (domain === 'mobs') return Math.floor((number_field(row, 'level_min') + number_field(row, 'level_max')) / 2)
  return null
}

export const content_row_level_label = (domain: SeedDomain, row: SeedEntityRow): string | null => {
  if (domain === 'mobs') return `Lv. ${number_field(row, 'level_min')}–${number_field(row, 'level_max')}`
  const level = content_row_level(domain, row)
  return level === null ? null : `Lv. ${level}`
}

export const order_content_rows = (domain: SeedDomain, rows: readonly SeedEntityRow[]): readonly SeedEntityRow[] => {
  if (domain !== 'items' && domain !== 'spells' && domain !== 'mobs') return rows
  return rows.toSorted(
    (left, right) =>
      (content_row_level(domain, left) ?? 0) - (content_row_level(domain, right) ?? 0) ||
      left.label.localeCompare(right.label)
  )
}

// a class's unlock ladder is a fixed set of levels; dragging a spell does not store an order —
// it re-stamps the ladder onto the new list order. Returns index-in-file → unlock_level, or null
// when the move lands inside a tie group and no level actually changes.
export const reordered_spell_levels = (
  rows: readonly SeedEntityRow[],
  from: number,
  to: number
): Readonly<Record<number, number>> | null => {
  if (from === to || from < 0 || to < 0 || from >= rows.length || to >= rows.length) return null
  const ladder = rows.map((row) => number_field(row, 'unlock_level'))
  const without_dragged = rows.filter((_, index) => index !== from)
  const changes = [...without_dragged.slice(0, to), rows[from]!, ...without_dragged.slice(to)].flatMap(
    (row, index): readonly (readonly [number, number])[] =>
      number_field(row, 'unlock_level') === ladder[index]! ? [] : [[Number(row.path[0]), ladder[index]!] as const]
  )
  return changes.length ? Object.freeze(Object.fromEntries(changes)) : null
}

export const item_recipe_job_rows = (
  item_rows: readonly SeedEntityRow[],
  recipe_rows: readonly SeedEntityRow[]
): readonly Readonly<{ job: string; count: number; item_types: readonly string[] }>[] => {
  const categories = new Map(item_rows.map((row) => [row.id, content_row_category(row)] as const))
  const outputs = recipe_rows.reduce<Record<string, readonly string[]>>((result, row) => {
    const recipe = record_value(row.value)
    const output_type = typeof recipe?.output_type === 'string' ? recipe.output_type : row.id
    const authored_job = typeof recipe?.job === 'string' ? recipe.job : ''
    const job = craft_job_of(categories.get(output_type) ?? '') ?? authored_job
    return job ? { ...result, [job]: Object.freeze([...(result[job] ?? []), output_type]) } : result
  }, {})
  return job_slugs.flatMap((job) => {
    const item_types = outputs[job]
    return item_types?.length ? [Object.freeze({ job, count: item_types.length, item_types })] : []
  })
}

export const item_gatherable_job_rows = (
  item_rows: readonly SeedEntityRow[]
): readonly Readonly<{ job: string; count: number; item_types: readonly string[] }>[] => {
  const item_ids = new Set(item_rows.map(({ id }) => id))
  return job_groups.gathering.flatMap((job) => {
    const item_types = Object.freeze(
      gatherable_catalog
        .filter((resource) => resource.job === job && item_ids.has(resource.item_type))
        .map(({ item_type }) => item_type)
    )
    return item_types.length ? [Object.freeze({ job, count: item_types.length, item_types })] : []
  })
}

export const item_resource_kind_rows = (
  item_rows: readonly SeedEntityRow[],
  recipe_rows: readonly SeedEntityRow[]
): readonly Readonly<{ kind: string; count: number; item_types: readonly string[] }>[] => {
  const outputs = new Set(recipe_rows.map(({ id }) => id))
  const pet_foods = new Set(
    recipe_rows.flatMap((row) => {
      const recipe = record_value(row.value)
      const inputs = record_value(recipe?.inputs)
      return inputs && rare_pet_food_tier(Object.keys(inputs)) !== null ? [row.id] : []
    })
  )
  const resources = item_rows.filter((row) => content_row_category(row) === 'resource')
  return resource_kinds.map((kind) => {
    const item_types = resources
      .filter((row) => item_resource_kind(row.id, outputs.has(row.id), pet_foods.has(row.id)) === kind)
      .map(({ id }) => id)
    return Object.freeze({ kind, count: item_types.length, item_types: Object.freeze(item_types) })
  })
}

export const item_mob_family_rows = (
  item_rows: readonly SeedEntityRow[],
  mob_rows: readonly SeedEntityRow[]
): readonly Readonly<{ family: string; count: number; item_types: readonly string[] }>[] => {
  const resource_ids = new Set(item_rows.filter((row) => content_row_category(row) === 'resource').map(({ id }) => id))
  const ownership = mob_rows.flatMap((mob_row) => {
    const mob = record_value(mob_row.value)
    const family = typeof mob?.family === 'string' ? mob.family : ''
    const loot = Array.isArray(mob?.loot) ? mob.loot : []
    return family
      ? loot.flatMap((entry) => {
          const item_type = record_value(entry)?.item_type
          return typeof item_type === 'string' && resource_ids.has(item_type)
            ? [Object.freeze({ family, item_type })]
            : []
        })
      : []
  })
  return unique(ownership.map(({ family }) => family))
    .toSorted()
    .map((family) => {
      const item_types = unique(ownership.filter((entry) => entry.family === family).map(({ item_type }) => item_type))
      return Object.freeze({ family, count: item_types.length, item_types })
    })
}

export type ItemFilterKind = 'category' | 'resource' | 'craft' | 'gather' | 'mob-family'

export type ItemFilterRow = Readonly<{
  kind: ItemFilterKind
  id: string
  count: number
  item_types: readonly string[]
}>

/** One live-draft taxonomy owns both item authoring and every recipe ingredient picker. */
export const item_filter_rows = (
  item_rows: readonly SeedEntityRow[],
  recipe_rows: readonly SeedEntityRow[],
  mob_rows: readonly SeedEntityRow[],
  world_rows: readonly SeedEntityRow[]
): readonly ItemFilterRow[] => {
  const categories = item_categories
    .filter((category) => category !== 'resource')
    .map((category): ItemFilterRow => {
      const item_types = item_rows.filter((row) => content_row_category(row) === category).map(({ id }) => id)
      return Object.freeze({
        kind: 'category',
        id: category,
        count: item_types.length,
        item_types: Object.freeze(item_types),
      })
    })
  const resources = item_resource_kind_rows(item_rows, recipe_rows).map(({ kind, count, item_types }) =>
    Object.freeze({ kind: 'resource' as const, id: kind, count, item_types })
  )
  const crafts = item_recipe_job_rows(item_rows, recipe_rows).map(({ job, count, item_types }) =>
    Object.freeze({ kind: 'craft' as const, id: job, count, item_types })
  )
  const gatherables = item_gatherable_job_rows(item_rows).map(({ job, count, item_types }) =>
    Object.freeze({ kind: 'gather' as const, id: job, count, item_types })
  )
  const families = item_mob_family_rows(item_rows, mob_rows).map(({ family, count, item_types }) =>
    Object.freeze({ kind: 'mob-family' as const, id: family, count, item_types })
  )
  return Object.freeze([...categories, ...resources, ...crafts, ...gatherables, ...families])
}

export const item_types_for_filter = (
  filter: string | null,
  rows: readonly ItemFilterRow[]
): ReadonlySet<string> | null => {
  if (!filter) return null
  const selected = rows.find(({ kind, id }) => `${kind}:${id}` === filter)
  return selected ? new Set(selected.item_types) : null
}

export const content_result_columns = (domain: SeedDomain): 1 | 2 => (domain === 'items' ? 2 : 1)

export const content_page_columns = (domain: SeedDomain): string => {
  if (domain === 'items')
    return 'grid-cols-[140px_150px_400px_minmax(420px,1fr)] max-xl:grid-cols-[120px_130px_340px_minmax(360px,1fr)]'
  if (domain === 'spells')
    return 'grid-cols-[140px_150px_250px_minmax(420px,1fr)] max-xl:grid-cols-[120px_130px_210px_minmax(360px,1fr)]'
  if (domain === 'mobs')
    return 'grid-cols-[140px_180px_280px_minmax(420px,1fr)] max-xl:grid-cols-[120px_160px_240px_minmax(360px,1fr)]'
  return 'grid-cols-[150px_260px_minmax(420px,1fr)] max-xl:grid-cols-[130px_220px_minmax(360px,1fr)]'
}

const string_list = (value: JsonValue | undefined): readonly string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []

const record_list = (value: JsonValue | undefined): readonly Readonly<Record<string, JsonValue>>[] =>
  Array.isArray(value)
    ? value.flatMap((entry) => {
        const record = record_value(entry)
        return record ? [record] : []
      })
    : []

const unique = (values: readonly string[]): readonly string[] => Object.freeze([...new Set(values)])

export const mob_filter_rows = (
  mob_rows: readonly SeedEntityRow[],
  world_rows: readonly SeedEntityRow[]
): readonly MobFilterRow[] => {
  const mob_ids = new Set(mob_rows.map(({ id }) => id))
  const mobs = mob_rows.map((row): MobFilterSource => {
    const mob = record_value(row.value)
    const role = typeof mob?.role === 'string' ? mob.role : ''
    return Object.freeze({
      mob_type: row.id,
      family: typeof mob?.family === 'string' ? mob.family : '',
      element: role !== 'protector' && typeof mob?.element === 'string' ? mob.element : '',
      role,
    })
  })
  const world_sources = world_rows.map((world_row): MobFilterWorldSource => {
    const world = record_value(world_row.value)
    const world_id = typeof world?.world === 'string' ? world.world : world_row.id
    const roaming = record_list(world?.mobs).flatMap((row) =>
      typeof row.mob_type === 'string'
        ? [
            Object.freeze({
              mob_type: row.mob_type,
              biomes: string_list(row.biomes),
              cities: string_list(row.cities),
            }),
          ]
        : []
    )
    const terrain = record_value(world?.terrain)
    const biome_names = record_list(terrain?.biomes).flatMap((biome) =>
      typeof biome.name === 'string' ? [biome.name] : []
    )
    const cities = record_list(world?.cities).flatMap((city) =>
      typeof city.city === 'string' ? [Object.freeze({ city: city.city })] : []
    )
    return Object.freeze({ world: world_id, biome_names, mobs: roaming, protectors: Object.freeze([]), cities })
  })
  const filters = derive_mob_filter_rows(mobs, world_sources)
  const protectors = job_slugs.flatMap((job): readonly MobFilterRow[] => {
    const members = unique(
      gatherable_catalog
        .filter((gatherable) => gatherable.job === job && mob_ids.has(gatherable.protector))
        .map(({ protector }) => protector)
    )
    return members.length
      ? [Object.freeze({ kind: 'protector', id: job, count: members.length, mob_types: members })]
      : []
  })
  return Object.freeze([...filters, ...protectors])
}

export const spell_class_rows = (
  rows: readonly SeedEntityRow[]
): readonly Readonly<{ classe: string; count: number }>[] => {
  const counts = rows.reduce<Record<string, number>>((result, row) => {
    const classe = content_row_classe(row)
    return classe ? { ...result, [classe]: (result[classe] ?? 0) + 1 } : result
  }, {})
  return class_names.flatMap((classe) => (counts[classe] ? [Object.freeze({ classe, count: counts[classe] })] : []))
}

export const filter_content_rows = (
  rows: readonly SeedEntityRow[],
  query: string,
  category: string | null,
  classe: string | null,
  item_types: ReadonlySet<string> | null = null
): readonly SeedEntityRow[] => {
  const normalized_query = query.trim().toLowerCase()
  return rows.filter(
    (row) =>
      (!category || content_row_category(row) === category) &&
      (!classe || content_row_classe(row) === classe) &&
      (!item_types || item_types.has(row.id)) &&
      (!normalized_query || row.label.toLowerCase().includes(normalized_query))
  )
}

export const content_category_for_filter = (domain: SeedDomain, filter: string | null): string | null =>
  domain === 'items' && filter?.startsWith('category:') ? filter.slice('category:'.length) : null

export const content_types_for_domain = (
  domain: SeedDomain,
  item_types: ReadonlySet<string> | null,
  mob_types: ReadonlySet<string> | null
): ReadonlySet<string> | null => (domain === 'items' ? item_types : domain === 'mobs' ? mob_types : null)

// rows are addressed by their JSON path, never by their label id: identity fields (a spell's
// name, a mob's mob_type) mutate while editing, paths do not — so selection and React keys
// survive renames and duplicate labels stay distinct
export const row_address = ({ path }: SeedEntityRow): string => path.join('.')

export const find_selected_row = (rows: readonly SeedEntityRow[], address: string | null): SeedEntityRow | undefined =>
  address === null ? undefined : rows.find((row) => row_address(row) === address)
