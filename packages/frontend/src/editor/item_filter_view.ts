// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { ItemFilterKind, ItemFilterRow } from './content_list.ts'
import { titleize_field } from './ContentFields.tsx'

const section_by_kind: Readonly<Record<ItemFilterKind, string | undefined>> = Object.freeze({
  category: undefined,
  resource: 'Resources',
  craft: 'Recipe outputs',
  gather: 'Gatherables',
  'mob-family': 'Mob resources',
})

export const item_filter_value = ({ kind, id }: ItemFilterRow): string => `${kind}:${id}`

const item_filter_label = ({ kind, id }: ItemFilterRow): string => {
  if (kind === 'resource') return id === 'pet_food' ? 'Pet foods' : `${titleize_field(id)} resources`
  if (kind === 'craft') return `Crafts ${titleize_field(id)}`
  if (kind === 'gather') return `Gatherables ${titleize_field(id)}`
  return titleize_field(id)
}

export const item_filter_view = (
  row: ItemFilterRow,
  previous_kind: ItemFilterKind | undefined
): Readonly<{ value: string; label: string; section?: string }> => {
  const section = previous_kind === row.kind ? undefined : section_by_kind[row.kind]
  return Object.freeze({
    value: item_filter_value(row),
    label: item_filter_label(row),
    ...(section ? { section } : {}),
  })
}
