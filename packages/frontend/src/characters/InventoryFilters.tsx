// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Search } from 'lucide-react'
import type { ItemRow } from '@aresrpg/protocol'

import { item_icon } from '../content/assets.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { useNumbers } from '../i18n/useNumbers.ts'

import {
  BAG_CATEGORIES,
  bag_category_of,
  InventoryResourceFilters,
  type BagCategory,
  type ResourceFilter,
} from './InventoryResourceFilters.tsx'

const category_art = { equipment: 'theban_scrapblade', consumables: 'recall_potion', resources: 'wheat_barley' }

export const InventoryFilters = ({
  category,
  set_category,
  resource_filter,
  set_resource_filter,
  query,
  set_query,
  items,
  copy,
}: Readonly<{
  category: BagCategory
  set_category: (category: BagCategory) => void
  resource_filter: ResourceFilter
  set_resource_filter: (filter: ResourceFilter) => void
  query: string
  set_query: (query: string) => void
  items: readonly Readonly<{ item: ItemRow }>[]
  copy: AppCopy
}>) => {
  const text = copy_text(copy.characters_page)
  const numbers = useNumbers()
  return (
    <div className="inventory-filters flex shrink-0 flex-col gap-2">
      <div className="chr-equip__bagtabs">
        {BAG_CATEGORIES.map((key) => (
          <button
            className={`chr-bagtab ${category === key ? 'is-active' : ''}`}
            aria-label={text(`bag_${key}`)}
            aria-pressed={category === key}
            title={text(`bag_${key}`)}
            key={key}
            onClick={() => {
              set_category(key)
            }}
            type="button"
          >
            <img src={item_icon(category_art[key]) ?? undefined} alt="" />
            <span className="inventory-category-name">{text(`bag_${key}`)}</span>
            <span className="inventory-category-count">
              {numbers.number(items.filter(({ item }) => bag_category_of(item) === key).length)}
            </span>
          </button>
        ))}
      </div>
      <label className="inventory-search">
        <Search size={18} aria-hidden="true" />
        <input
          type="search"
          aria-label={copy.ui.inventory_search}
          placeholder={copy.ui.inventory_search}
          value={query}
          onChange={(event) => {
            set_query(event.target.value)
          }}
        />
      </label>
      <InventoryResourceFilters
        category={category}
        filter={resource_filter}
        select={set_resource_filter}
        items={items}
        copy={copy}
      />
    </div>
  )
}
