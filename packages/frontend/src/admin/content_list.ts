// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { item_categories } from '@aresrpg/immutable'

import { admin_content_domains, type JsonValue, type SeedDomain, type SeedEntityRow } from './seed_editor.ts'

export const content_navigation_domains = admin_content_domains.filter(({ id }) => id !== 'worlds' && id !== 'recipes')

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

export const filter_content_rows = (
  rows: readonly SeedEntityRow[],
  query: string,
  category: string | null
): readonly SeedEntityRow[] => {
  const normalized_query = query.trim().toLowerCase()
  return rows.filter(
    (row) =>
      (!category || content_row_category(row) === category) &&
      (!normalized_query || row.label.toLowerCase().includes(normalized_query))
  )
}
