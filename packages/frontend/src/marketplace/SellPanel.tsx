// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useState } from 'react'
import { Package } from 'lucide-react'

import { InventoryFilters } from '../characters/InventoryFilters.tsx'
import { InventoryItemCell } from '../characters/InventoryItemCell.tsx'
import { bag_item_matches, type BagCategory, type ResourceFilter } from '../characters/InventoryResourceFilters.tsx'
import { ItemDetailContext } from '../components/ItemDetailContext.ts'
import type { CopyText } from '../i18n/copy.ts'
import { Text } from '../i18n/Text.tsx'
import { useAppStore } from '../store.ts'

import { useMarketSell } from './useMarketSell.ts'
import { OwnListings } from './OwnListings.tsx'
import { SaleDialog } from './SaleDialog.tsx'

export const SellPanel = ({ text }: Readonly<{ text: CopyText }>) => {
  const sale = useMarketSell()
  const { items, characters, selected, choose, set_selected_key, localized_numbers } = sale
  const copy = useAppStore((state) => state.copy)
  const [category, set_category] = useState<BagCategory>('equipment')
  const [resource_filter, set_resource_filter] = useState<ResourceFilter>('all')
  const [query, set_query] = useState('')
  const matches_name = (name: string) => name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  const filtered = items.filter(({ row }) => bag_item_matches(row, category, resource_filter) && matches_name(row.name))
  const visible_characters = characters.filter(({ name }) => matches_name(name))

  return (
    <ItemDetailContext.Provider value="summary">
      <div className="market-sell min-h-0 min-w-0 flex-1 bg-bg">
        <OwnListings text={text} />
        <section
          className="market-inventory flex min-h-0 min-w-0 flex-col bg-surface-high"
          aria-label={text('inventory')}
        >
          <h3 className="market-panel-title">
            <Package size={16} aria-hidden="true" />
            {text('inventory')}
            <span className="market-count">{localized_numbers.number(items.length + characters.length)}</span>
          </h3>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <p className="mb-3 text-xs text-muted">{text('select_to_list')}</p>
            {copy && (
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
            )}
            <div className="market-inventory-grid my-3" data-marketplace-inventory>
              {filtered.map((selection) => (
                <InventoryItemCell
                  key={selection.row.id}
                  item={selection.row}
                  amount={selection.total_amount}
                  show_level
                  onClick={() => choose(selection)}
                  data-marketplace-owned-item={selection.row.id}
                />
              ))}
            </div>
            {filtered.length === 0 && (
              <p className="py-6 text-center text-xs text-muted">
                {text(items.length ? 'filter_empty' : 'empty_inventory')}
              </p>
            )}
            {visible_characters.length > 0 && (
              <>
                <h4 className="mt-5 mb-2 text-xs tracking-widest text-muted uppercase">{text('characters')}</h4>
                <div className="flex flex-wrap gap-2">
                  {visible_characters.map((row) => (
                    <button
                      className="min-h-14 cursor-pointer border border-border bg-surface p-3 text-left text-xs text-text hover:border-gold"
                      key={row.id}
                      onClick={() => choose({ kind: 'character', row })}
                      type="button"
                    >
                      <span className="block">{row.name}</span>
                      <span className="text-muted">
                        {row.classe} · <Text path="encyclopedia_page.level_short" values={{ level: row.level }} />
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </section>
      </div>
      {selected && <SaleDialog sale={sale} selected={selected} text={text} close={() => set_selected_key(null)} />}
    </ItemDetailContext.Provider>
  )
}
