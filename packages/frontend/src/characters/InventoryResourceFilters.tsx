// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { DragScroll } from '@aresrpg/ui'
import type { ItemRow } from '@aresrpg/protocol'

import { encyclopedia_catalog } from '../content/catalog.ts'
import { item_resource_kind } from '../content/resource_kind.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'

export const BAG_CATEGORIES = ['equipment', 'consumables', 'resources'] as const
export type BagCategory = (typeof BAG_CATEGORIES)[number]
const RESOURCE_FILTERS = ['all', 'raw', 'gatherable', 'intermediary', 'keys', 'runes'] as const
export type ResourceFilter = (typeof RESOURCE_FILTERS)[number]

export const bag_category_of = (item: Readonly<ItemRow>): BagCategory => {
  if (item.category === 'consumable') return 'consumables'
  if (['resource', 'rune', 'key'].includes(item.category)) return 'resources'
  return 'equipment'
}

const resource_filter_of = (item: Readonly<ItemRow>) => {
  if (item.category === 'key') return 'keys'
  if (item.category === 'rune') return 'runes'
  if (item.category !== 'resource') return null
  return item_resource_kind(item.item_type, !!encyclopedia_catalog.item(item.item_type)?.recipe)
}

export const bag_item_matches = (item: Readonly<ItemRow>, category: BagCategory, filter: ResourceFilter): boolean =>
  bag_category_of(item) === category &&
  (category !== 'resources' || filter === 'all' || resource_filter_of(item) === filter)

export const InventoryResourceFilters = ({
  category,
  filter,
  select,
  items,
  copy,
}: Readonly<{
  category: BagCategory
  filter: ResourceFilter
  select: (filter: ResourceFilter) => void
  items: readonly Readonly<{ item: ItemRow }>[]
  copy: AppCopy
}>) => {
  if (category !== 'resources') return null
  const text = copy_text(copy.characters_page)
  return (
    <DragScroll className="inventory-resource-filters" role="group" aria-label={text('bag_resources')}>
      {RESOURCE_FILTERS.map((key) => (
        <button
          type="button"
          key={key}
          aria-pressed={filter === key}
          onClick={() => select(key)}
          className="inventory-resource-filter"
        >
          {text(`bag_filter_${key}`)}
          <span className="ml-2 tabular-nums opacity-60">
            {items.filter(({ item }) => bag_item_matches(item, 'resources', key)).length}
          </span>
        </button>
      ))}
    </DragScroll>
  )
}
