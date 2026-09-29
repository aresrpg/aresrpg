// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState } from 'react'
import type { ItemRow } from '@aresrpg/protocol'
import { Button, GameWindow, NativeModal } from '@aresrpg/ui'

import { useNumbers } from '../i18n/useNumbers.ts'
import { item_icon } from '../content/assets.ts'
import type { AppCopy, CopyText } from '../i18n/copy.ts'
import { SuiUnit } from '../marketplace/marketplace_model.tsx'

import { OwnedItemDetail } from './OwnedItemDetail.tsx'
import { TRADE_INVENTORY_CATEGORIES, trade_inventory_category, type TradeInventoryCategory } from './trade_view.ts'
export const TradeInventory = ({
  items,
  can_edit,
  add_asset,
  balance,
  category_text,
  text,
  copy,
}: Readonly<{
  copy: AppCopy
  items: readonly ItemRow[]
  can_edit: boolean
  add_asset: (id: string) => void
  balance: bigint | null
  category_text: CopyText
  text: CopyText
}>) => {
  const [inspected, inspect] = useState<ItemRow | null>(null)
  const localized_numbers = useNumbers()
  const [category, set_category] = useState<TradeInventoryCategory>('equipment')
  const count = (key: TradeInventoryCategory): number =>
    items.filter((item) => trade_inventory_category(item) === key).length
  const counts = Object.fromEntries(TRADE_INVENTORY_CATEGORIES.map((key) => [key, count(key)])) as Record<
    TradeInventoryCategory,
    number
  >
  const visible = items.filter((item) => trade_inventory_category(item) === category)
  return (
    <section className="trade-inventory">
      <header>
        <b>{text('inventory')}</b>
        <div className="trade-inventory-meta">
          <span>{text('drag_hint')}</span>
          <output aria-label={text('sui')} className="trade-wallet-balance">
            <SuiUnit size={10} />
            <strong>{balance === null ? '—' : localized_numbers.sui(balance, 2)}</strong>
          </output>
        </div>
      </header>
      <nav className="trade-inventory-tabs">
        {TRADE_INVENTORY_CATEGORIES.map((key) => (
          <button
            className={category === key ? 'is-active' : ''}
            key={key}
            onClick={() => set_category(key)}
            type="button"
          >
            {category_text(`bag_${key}`)}
            <span>{counts[key]}</span>
          </button>
        ))}
      </nav>
      <div className="trade-inventory-grid">
        {visible.map((item) => (
          <div className="trade-inventory-cell" key={item.id}>
            <button
              onClick={() => inspect(item)}
              draggable={can_edit}
              key={item.id}
              onDragStart={(event) => event.dataTransfer.setData('text/plain', item.id)}
              title={item.name}
              type="button"
            >
              {item_icon(item.item_type) ? (
                <img alt="" draggable={false} src={item_icon(item.item_type)!} />
              ) : (
                <span>{item.name.slice(0, 1).toUpperCase()}</span>
              )}
              {item.amount > 1 && <small>×{item.amount}</small>}
              <i>{item.level}</i>
            </button>
            <Button
              className="trade-inventory-add"
              aria-label={`${text('amount_add')} ${item.name}`}
              disabled={!can_edit}
              onClick={() => add_asset(item.id)}
            >
              +
            </Button>
          </div>
        ))}
        {visible.length === 0 && <p>{text('empty_inventory')}</p>}
      </div>
      {inspected && (
        <NativeModal close={() => inspect(null)} label={inspected.name} className="aui-modal-scrim">
          <GameWindow
            title={inspected.name}
            close={() => inspect(null)}
            close_label={copy.wallet_close}
            draggable
            className="aui-inspection aui-inspection--item"
          >
            <OwnedItemDetail item={inspected} copy={copy} />
            <div className="aui-inspection-actions">
              <Button
                tone="primary"
                disabled={!can_edit}
                onClick={() => {
                  add_asset(inspected.id)
                  inspect(null)
                }}
              >
                {text('amount_add')}
              </Button>
            </div>
          </GameWindow>
        </NativeModal>
      )}
    </section>
  )
}
