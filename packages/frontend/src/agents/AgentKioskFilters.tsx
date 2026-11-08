// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ItemRow } from '@aresrpg/protocol'
import { Search } from 'lucide-react'

import { item_icon } from '../content/assets.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import {
  BAG_CATEGORIES,
  bag_category_of,
  InventoryResourceFilters,
  type BagCategory,
  type ResourceFilter,
} from '../characters/InventoryResourceFilters.tsx'

const art = { equipment: 'theban_scrapblade', consumables: 'recall_potion', resources: 'wheat_barley' }

/** Compact dock controls never inherit the full player bag's tab geometry. */
export const AgentKioskFilters = ({
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
  set_category: (value: BagCategory) => void
  resource_filter: ResourceFilter
  set_resource_filter: (value: ResourceFilter) => void
  query: string
  set_query: (value: string) => void
  items: readonly Readonly<{ item: ItemRow }>[]
  copy: AppCopy
}>) => {
  const text = copy_text(copy.characters_page)
  return (
    <div className="agent-kiosk__filters">
      <div className="agent-kiosk__categories">
        {BAG_CATEGORIES.map((key) => (
          <button
            type="button"
            key={key}
            aria-label={text(`bag_${key}`)}
            title={text(`bag_${key}`)}
            aria-pressed={key === category}
            onClick={() => set_category(key)}
          >
            <img src={item_icon(art[key]) ?? undefined} alt="" />
            <span>{items.filter(({ item }) => bag_category_of(item) === key).length}</span>
          </button>
        ))}
      </div>
      <label className="inventory-search">
        <Search size={14} aria-hidden="true" />
        <input
          type="search"
          aria-label={copy.ui.inventory_search}
          placeholder={copy.ui.inventory_search}
          value={query}
          onChange={(event) => set_query(event.target.value)}
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
