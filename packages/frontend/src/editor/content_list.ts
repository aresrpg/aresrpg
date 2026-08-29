// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  class_names,
  craft_job_of,
  gatherable_catalog,
  gatherable_of,
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

export const item_category_rows = (
  rows: readonly SeedEntityRow[]
): readonly Readonly<{ category: string; count: number }>[] => {
  const counts = rows.reduce<Record<string, number>>((result, row) => {
    const category = content_row_category(row)
    return category ? { ...result, [category]: (result[category] ?? 0) + 1 } : result
  }, {})
  return item_categories.map((category) => Object.freeze({ category, count: counts[category] ?? 0 }))
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
  item_rows: readonly SeedEntityRow[],
  world_rows: readonly SeedEntityRow[]
): readonly Readonly<{ job: string; count: number; item_types: readonly string[] }>[] => {
  const item_ids = new Set(item_rows.map(({ id }) => id))
  const resources = world_rows.flatMap((world_row) => {
    const rows = record_value(world_row.value)?.resources
    return Array.isArray(rows)
      ? rows.flatMap((entry) => {
          const resource = record_value(entry)
          if (typeof resource?.item_type !== 'string') return []
          const gatherable = gatherable_of(resource.item_type)
          return gatherable ? [Object.freeze({ item_type: resource.item_type, job: gatherable.job })] : []
        })
      : []
  })
  return job_groups.gathering.flatMap((job) => {
    const item_types = Object.freeze([
      ...new Set(
        resources
          .filter((resource) => resource.job === job && item_ids.has(resource.item_type))
          .map(({ item_type }) => item_type)
      ),
    ])
    return item_types.length ? [Object.freeze({ job, count: item_types.length, item_types })] : []
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

export type ItemReferenceFilterRow = Readonly<{
  kind: 'category' | 'world' | 'family'
  id: string
  count: number
  item_types: readonly string[]
}>

/** Picker taxonomy stays derived from the live drafts: categories cover all items, while
 * World and Family intentionally expose only resources obtainable from their authored
 * gatherables, rares, roaming/protector/dungeon mob loot. */
export const item_reference_filter_rows = (
  item_rows: readonly SeedEntityRow[],
  mob_rows: readonly SeedEntityRow[],
  world_rows: readonly SeedEntityRow[]
): readonly ItemReferenceFilterRow[] => {
  const resource_ids = new Set(item_rows.filter((row) => content_row_category(row) === 'resource').map(({ id }) => id))
  const categories = item_categories.flatMap((category): readonly ItemReferenceFilterRow[] => {
    const item_types = item_rows.filter((row) => content_row_category(row) === category).map(({ id }) => id)
    return item_types.length
      ? [
          Object.freeze({
            kind: 'category',
            id: category,
            count: item_types.length,
            item_types: Object.freeze(item_types),
          }),
        ]
      : []
  })
  const mobs_by_type = new Map(mob_rows.map((row) => [row.id, record_value(row.value)] as const))
  const worlds = world_rows.flatMap((world_row): readonly ItemReferenceFilterRow[] => {
    const world = record_value(world_row.value)
    const world_id = typeof world?.world === 'string' ? world.world : world_row.id
    const resources = Array.isArray(world?.resources) ? world.resources : []
    const direct_resources = resources.flatMap((entry) => {
      const item_type = record_value(entry)?.item_type
      if (typeof item_type !== 'string') return []
      const gatherable = gatherable_of(item_type)
      return gatherable ? [item_type, gatherable.rare_item_type] : [item_type]
    })
    const protectors = resources.flatMap((entry) => {
      const item_type = record_value(entry)?.item_type
      const gatherable = typeof item_type === 'string' ? gatherable_of(item_type) : null
      return gatherable ? [gatherable.protector] : []
    })
    const roaming = Array.isArray(world?.mobs)
      ? world.mobs.flatMap((entry) => {
          const mob_type = record_value(entry)?.mob_type
          return typeof mob_type === 'string' ? [mob_type] : []
        })
      : record_value(world?.mobs)
        ? Object.keys(record_value(world?.mobs)!)
        : []
    const dungeon = record_value(world?.dungeon)
    const dungeon_mobs = Array.isArray(dungeon?.rooms)
      ? dungeon.rooms.flatMap((room) =>
          Array.isArray(room)
            ? room.flatMap((entry) => {
                const mob_type = record_value(entry)?.mob_type
                return typeof mob_type === 'string' ? [mob_type] : []
              })
            : []
        )
      : []
    const loot = unique([...roaming, ...protectors, ...dungeon_mobs]).flatMap((mob_type) => {
      const rows = mobs_by_type.get(mob_type)?.loot
      return Array.isArray(rows)
        ? rows.flatMap((entry) => {
            const item_type = record_value(entry)?.item_type
            return typeof item_type === 'string' ? [item_type] : []
          })
        : []
    })
    const item_types = unique([...direct_resources, ...loot]).filter((item_type) => resource_ids.has(item_type))
    return item_types.length
      ? [Object.freeze({ kind: 'world', id: world_id, count: item_types.length, item_types })]
      : []
  })
  const families = item_mob_family_rows(item_rows, mob_rows).map(({ family, count, item_types }) =>
    Object.freeze({ kind: 'family' as const, id: family, count, item_types })
  )
  return Object.freeze([...categories, ...worlds, ...families])
}

export const item_types_for_filter = (
  filter: string | null,
  recipe_jobs: ReturnType<typeof item_recipe_job_rows>,
  gatherable_jobs: ReturnType<typeof item_gatherable_job_rows>,
  mob_families: ReturnType<typeof item_mob_family_rows>
): ReadonlySet<string> | null => {
  if (filter?.startsWith('craft:')) {
    const selected_job = filter.slice('craft:'.length)
    return new Set(recipe_jobs.find(({ job }) => job === selected_job)?.item_types ?? [])
  }
  if (filter?.startsWith('gather:')) {
    const selected_job = filter.slice('gather:'.length)
    return new Set(gatherable_jobs.find(({ job }) => job === selected_job)?.item_types ?? [])
  }
  if (filter?.startsWith('mob-family:')) {
    const selected_family = filter.slice('mob-family:'.length)
    return new Set(mob_families.find(({ family }) => family === selected_family)?.item_types ?? [])
  }
  return null
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

const unique = (values: readonly string[]): readonly string[] => Object.freeze([...new Set(values)])

export const mob_filter_rows = (
  mob_rows: readonly SeedEntityRow[],
  world_rows: readonly SeedEntityRow[]
): readonly MobFilterRow[] => {
  const mob_ids = new Set(mob_rows.map(({ id }) => id))
  const mobs = mob_rows.map((row): MobFilterSource => {
    const mob = record_value(row.value)
    return Object.freeze({
      mob_type: row.id,
      family: typeof mob?.family === 'string' ? mob.family : '',
      element: typeof mob?.element === 'string' ? mob.element : '',
      role: typeof mob?.role === 'string' ? mob.role : '',
    })
  })
  const world_sources = world_rows.map((world_row): MobFilterWorldSource => {
    const world = record_value(world_row.value)
    const world_id = typeof world?.world === 'string' ? world.world : world_row.id
    const roaming = Array.isArray(world?.mobs)
      ? world.mobs.flatMap((entry) => {
          const row = record_value(entry)
          return typeof row?.mob_type === 'string'
            ? [Object.freeze({ mob_type: row.mob_type, biomes: string_list(row.biomes) })]
            : []
        })
      : []
    const protectors = Array.isArray(world?.resources)
      ? world.resources.flatMap((entry) => {
          const row = record_value(entry)
          const gatherable = typeof row?.item_type === 'string' ? gatherable_of(row.item_type) : null
          return gatherable ? [Object.freeze({ mob_type: gatherable.protector, biomes: string_list(row?.biomes) })] : []
        })
      : []
    const terrain = record_value(world?.terrain)
    const biome_names = Array.isArray(terrain?.biomes)
      ? terrain.biomes.flatMap((entry) => {
          const biome = record_value(entry)
          return typeof biome?.name === 'string' ? [biome.name] : []
        })
      : []
    return Object.freeze({ world: world_id, biome_names, mobs: roaming, protectors })
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

export const mob_types_for_protector_visibility = (
  rows: readonly SeedEntityRow[],
  selected_types: ReadonlySet<string> | null,
  hide_protectors: boolean
): ReadonlySet<string> | null => {
  if (!hide_protectors) return selected_types
  return new Set(
    rows
      .filter((row) => record_value(row.value)?.role !== 'protector' && (!selected_types || selected_types.has(row.id)))
      .map(({ id }) => id)
  )
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
