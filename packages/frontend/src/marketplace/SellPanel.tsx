// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useState } from 'react'
import { MarketSell } from '@aresrpg/ui'
import { Package } from 'lucide-react'

import { InventoryFilters } from '../characters/InventoryFilters.tsx'
import { InventoryItemCell } from '../characters/InventoryItemCell.tsx'
import { bag_item_matches, type BagCategory, type ResourceFilter } from '../characters/InventoryResourceFilters.tsx'
import { ItemDetailContext } from '../components/ItemDetailContext.ts'
import type { CopyText } from '../i18n/copy.ts'
import { useText } from '../i18n/useText.ts'
import { useAppStore } from '../store.ts'

import { useMarketSell } from './useMarketSell.ts'
import { OwnListings } from './OwnListings.tsx'
import { SaleDialog } from './SaleDialog.tsx'

export const SellPanel = ({ text }: Readonly<{ text: CopyText }>) => {
  const sale = useMarketSell()
  const { items, characters, selected, choose, set_selected_key, localized_numbers } = sale
  const copy = useAppStore((state) => state.copy)
  const ui = useText()
  const [category, set_category] = useState<BagCategory>('equipment')
  const [resource_filter, set_resource_filter] = useState<ResourceFilter>('all')
  const [query, set_query] = useState('')
  const matches_name = (name: string) => name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  const filtered = items.filter(({ row }) => bag_item_matches(row, category, resource_filter) && matches_name(row.name))
  const visible_characters = characters.filter(({ name }) => matches_name(name))

  return (
    <ItemDetailContext.Provider value="summary">
      <MarketSell
        listings={<OwnListings text={text} />}
        labels={{
          inventory: text('inventory'),
          select_to_list: text('select_to_list'),
          characters: text('characters'),
        }}
        Icon={Package}
        count={localized_numbers.number(items.length + characters.length)}
        filters={
          copy && (
            <InventoryFilters
              category={category}
              set_category={set_category}
              resource_filter={resource_filter}
              set_resource_filter={set_resource_filter}
              query={query}
              set_query={set_query}
              items={items.map(({ row }) => ({ item: row }))}
              copy={copy}
            />
          )
        }
        cells={filtered.map((selection) => (
          <InventoryItemCell
            key={selection.row.id}
            item={selection.row}
            amount={selection.total_amount}
            show_level
            onClick={() => choose(selection)}
            data-marketplace-owned-item={selection.row.id}
          />
        ))}
        empty={filtered.length === 0 ? text(items.length ? 'filter_empty' : 'empty_inventory') : null}
        characters={visible_characters.map((row) => ({
          key: row.id,
          name: row.name,
          classe: row.classe,
          level: ui('encyclopedia_page.level_short', { level: row.level }),
          choose: () => choose({ kind: 'character', row }),
        }))}
      />
      {selected && <SaleDialog sale={sale} selected={selected} text={text} close={() => set_selected_key(null)} />}
    </ItemDetailContext.Provider>
  )
}
