// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState } from 'react'
import type { ItemRow } from '@aresrpg/protocol'
import type { AgentInventoryItem } from '@aresrpg/sdk/agent-inventory'

import type { AppCopy } from '../i18n/copy.ts'
import { InventoryItemCell } from '../characters/InventoryItemCell.tsx'
import { InventorySelectionGrid } from '../characters/InventorySelectionGrid.tsx'
import { bag_item_matches, type BagCategory, type ResourceFilter } from '../characters/InventoryResourceFilters.tsx'
import { select_inventory_item } from '../characters/inventory_selection.ts'
import { OwnedItemDetail } from '../components/OwnedItemDetail.tsx'
import { SendModalShell } from '../components/SendModalShell.tsx'

import { AgentKioskFilters } from './AgentKioskFilters.tsx'
import { agent_inventory_groups } from './inventory_transfer.ts'

export const AgentKioskGrid = ({
  rows,
  copy,
  disabled,
  transfer,
  pending_ids,
}: Readonly<{
  rows: readonly AgentInventoryItem[]
  copy: AppCopy
  disabled: boolean
  pending_ids: ReadonlySet<string>
  transfer: (ids: readonly string[], point: Readonly<{ x: number; y: number }>) => boolean
}>) => {
  const [category, set_category] = useState<BagCategory>('equipment')
  const [resource_filter, set_resource_filter] = useState<ResourceFilter>('all')
  const [query, set_query] = useState('')
  const [selected, select] = useState<readonly string[]>([])
  const [inspected, inspect] = useState<ItemRow | null>(null)
  const groups = agent_inventory_groups(rows)
  const filtered = groups.filter(
    ({ item }) =>
      bag_item_matches(item, category, resource_filter) &&
      item.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())
  )
  return (
    <>
      <AgentKioskFilters
        category={category}
        set_category={(value) => {
          set_category(value)
          select([])
        }}
        resource_filter={resource_filter}
        set_resource_filter={set_resource_filter}
        query={query}
        set_query={set_query}
        items={groups}
        copy={copy}
      />
      <InventorySelectionGrid
        class_name="agent-kiosk__grid"
        items={groups.map(({ item }) => item)}
        selected={selected}
        change={select}
        copy={copy}
        disabled={disabled}
        transfer={transfer}
      >
        {filtered.map(({ item, items, amount, status, locked }) => (
          <div className="agent-kiosk__cell" key={item.id}>
            <InventoryItemCell
              item={item}
              amount={amount}
              disabled={disabled || locked}
              pending={items.some(({ id }) => pending_ids.has(id))}
              aria-pressed={selected.includes(item.id)}
              class_name={selected.includes(item.id) ? 'is-selected' : ''}
              onClick={(event) =>
                event.shiftKey ? select(select_inventory_item(selected, item.id, true)) : inspect(item)
              }
            />
            <span hidden={status === 'available'} className="agent-kiosk__item-state">
              {copy.ui[`agent_asset_${status}`]}
            </span>
          </div>
        ))}
      </InventorySelectionGrid>
      {inspected && (
        <SendModalShell
          title={inspected.name}
          close={() => inspect(null)}
          close_label={copy.wallet_close}
          locked={false}
        >
          <OwnedItemDetail item={inspected} copy={copy} />
        </SendModalShell>
      )}
    </>
  )
}
