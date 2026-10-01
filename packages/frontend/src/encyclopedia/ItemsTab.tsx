// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useMemo, useState } from 'react'
import type { StatName } from '@aresrpg/immutable'
import { Collection } from '@aresrpg/ui'

import { item_icon } from '../content/assets.ts'
import { encyclopedia_catalog } from '../content/catalog.ts'
import { filter_item_types } from '../content/item_filters.ts'
import { useItemCategoryName } from '../i18n/useItemCategoryName.ts'

import { ItemFilters, type ItemFilterSelection } from './ItemFilters.tsx'
import type { EncyclopediaText } from './copy.ts'
export const ItemsTab = ({
  selected_id,
  select_item,
  select_mob,
  select_world,
  text,
  stat_name,
}: Readonly<{
  selected_id: string | null
  select_item: (id: string) => void
  select_mob: (id: string) => void
  select_world: (id: string) => void
  text: EncyclopediaText
  stat_name: (stat: StatName) => string
}>) => {
  const [search, set_search] = useState('')
  const category_name = useItemCategoryName()
  const [facet_selection, set_facet_selection] = useState<ItemFilterSelection>({})
  const [sort, set_sort] = useState('level_asc')
  const matching_types = useMemo(
    () =>
      new Set(
        filter_item_types(
          encyclopedia_catalog.items.map(({ item_type }) => item_type),
          encyclopedia_catalog.item_filters,
          facet_selection
        )
      ),
    [facet_selection]
  )
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return encyclopedia_catalog.items
      .filter(
        (item) =>
          (!query || item.name.toLowerCase().includes(query) || item.item_type.includes(query)) &&
          matching_types.has(item.item_type)
      )
      .toSorted((left, right) =>
        sort === 'name_asc'
          ? left.name.localeCompare(right.name)
          : sort === 'level_desc'
            ? right.level - left.level || left.name.localeCompare(right.name)
            : left.level - right.level || left.name.localeCompare(right.name)
      )
  }, [matching_types, search, sort])
  return (
    <div className="aui-catalogue-browser">
      <div className="aui-catalogue-tools">
        <input
          className="aui-input"
          type="search"
          aria-label={text('search_items')}
          placeholder={text('search_items')}
          value={search}
          onChange={(event) => set_search(event.currentTarget.value)}
        />
        <select
          className="aui-input"
          aria-label={text('sort_level_asc')}
          value={sort}
          onChange={(event) => set_sort(event.currentTarget.value)}
        >
          <option value="level_asc">{text('sort_level_asc')}</option>
          <option value="level_desc">{text('sort_level_desc')}</option>
          <option value="name_asc">{text('sort_name_asc')}</option>
        </select>
        <small>{text('showing_count', { count: filtered.length, total: encyclopedia_catalog.items.length })}</small>
        <ItemFilters
          rows={encyclopedia_catalog.item_filters}
          selected={facet_selection}
          select={set_facet_selection}
          text={text}
          stat_name={stat_name}
          total={encyclopedia_catalog.items.length}
        />
      </div>
      <Collection
        label={text('items')}
        selected={selected_id}
        select={select_item}
        entries={filtered.map((item) => ({
          id: item.item_type,
          label: item.name,
          image: item_icon(item.item_type) ?? undefined,
          meta: category_name(item.category),
          badge: text('level_short', { level: item.level }),
        }))}
      />
    </div>
  )
}
