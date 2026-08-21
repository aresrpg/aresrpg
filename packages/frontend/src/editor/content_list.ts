// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { class_names, item_categories } from '@aresrpg/immutable'

import { seed_content_domains, type JsonValue, type SeedDomain, type SeedEntityRow } from './seed_editor.ts'

export const content_navigation_domains = seed_content_domains.filter(({ id }) => id !== 'worlds' && id !== 'recipes')

const record_value = (value: JsonValue): Readonly<Record<string, JsonValue>> | null =>
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

export const content_row_level = (domain: SeedDomain, row: SeedEntityRow): number | null => {
  if (domain === 'items') return number_field(row, 'level')
  if (domain === 'spells') return number_field(row, 'unlock_level')
  return null
}

export const order_content_rows = (domain: SeedDomain, rows: readonly SeedEntityRow[]): readonly SeedEntityRow[] => {
  if (domain !== 'items' && domain !== 'spells') return rows
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
  return item_categories.flatMap((category) =>
    counts[category] ? [Object.freeze({ category, count: counts[category] })] : []
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
  classe: string | null
): readonly SeedEntityRow[] => {
  const normalized_query = query.trim().toLowerCase()
  return rows.filter(
    (row) =>
      (!category || content_row_category(row) === category) &&
      (!classe || content_row_classe(row) === classe) &&
      (!normalized_query || row.label.toLowerCase().includes(normalized_query))
  )
}

// rows are addressed by their JSON path, never by their label id: identity fields (a spell's
// name, a mob's mob_type) mutate while editing, paths do not — so selection and React keys
// survive renames and duplicate labels stay distinct
export const row_address = ({ path }: SeedEntityRow): string => path.join('.')

export const find_selected_row = (rows: readonly SeedEntityRow[], address: string | null): SeedEntityRow | undefined =>
  address === null ? undefined : rows.find((row) => row_address(row) === address)
