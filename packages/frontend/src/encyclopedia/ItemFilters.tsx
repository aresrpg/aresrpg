// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Button, FilterMenu } from '@aresrpg/ui'
import { ChevronDown, X } from 'lucide-react'

import { titleize } from '../content/catalog.ts'
import type { ItemFilterGroup, ItemFilterRow } from '../content/item_filters.ts'
import { useItemCategoryName } from '../i18n/useItemCategoryName.ts'

import type { EncyclopediaText } from './copy.ts'
export type ItemFilterSelection = Readonly<Partial<Record<ItemFilterGroup, string>>>
const GROUPS = ['category', 'resource', 'job', 'world', 'family'] as const
const TITLES = {
  category: 'filter_by_category',
  resource: 'filter_by_resource',
  job: 'filter_by_job',
  world: 'filter_by_world',
  family: 'filter_by_mob_family',
} as const
const option_label = (row: ItemFilterRow, text: EncyclopediaText) =>
  row.group === 'resource'
    ? text(`group_${row.id}_resources`)
    : titleize(row.parent ? row.id.slice(row.id.indexOf(':') + 1) : row.id)
export const ItemFilters = ({
  rows,
  selected,
  select,
  text,
  total,
}: Readonly<{
  rows: readonly ItemFilterRow[]
  selected: ItemFilterSelection
  select: (selection: ItemFilterSelection) => void
  text: EncyclopediaText
  total: number
}>) => {
  const category_name = useItemCategoryName()
  const select_option = (group: ItemFilterGroup, id: string) => {
    const remaining = Object.fromEntries(Object.entries(selected).filter(([key]) => key !== group))
    select(selected[group] === id ? remaining : { ...remaining, [group]: id })
  }
  return (
    <nav className="aui-item-filters" aria-label={text('items')}>
      <Button aria-pressed={Object.keys(selected).length === 0} onClick={() => select({})}>
        {text('view_all')}
        <small>{total}</small>
      </Button>
      {GROUPS.map((group) => (
        <FilterMenu
          key={group}
          title={text(TITLES[group])}
          close_label={text('back_to_list')}
          value={selected[group]}
          choose={(id) => select_option(group, id)}
          options={rows
            .filter((row) => row.group === group)
            .map((row) => ({
              id: row.id,
              label: row.group === 'category' ? category_name(row.id) : option_label(row, text),
              count: row.item_types.length,
            }))}
        />
      ))}
    </nav>
  )
}
