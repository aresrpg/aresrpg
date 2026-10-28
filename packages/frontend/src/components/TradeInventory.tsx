// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState, type CSSProperties } from 'react'
import type { ItemRow } from '@aresrpg/protocol'
import { ChevronLeft } from 'lucide-react'
import { Button, GameWindow, NativeModal } from '@aresrpg/ui'

import { useNumbers } from '../i18n/useNumbers.ts'
import type { AppCopy, CopyText } from '../i18n/copy.ts'
import { SuiUnit } from '../marketplace/marketplace_model.tsx'

import { OwnedItemDetail } from './OwnedItemDetail.tsx'
import { TradeSlotFace } from './TradeOfferCaps.tsx'
import {
  TRADE_INVENTORY_CATEGORIES,
  trade_amount_presets,
  trade_inventory_category,
  type TradeInventoryCategory,
} from './trade_view.ts'

/** One stack's amount, chosen in place of the inventory grid; opening it again starts from half the stack. */
const TradeAmountPicker = ({
  item,
  can_edit,
  choose,
  close,
  text,
}: Readonly<{
  item: Readonly<ItemRow>
  can_edit: boolean
  choose: (amount: number) => void
  close: () => void
  text: CopyText
}>) => {
  const [amount, set_amount] = useState(Math.ceil(item.amount / 2))
  const pick = (value: number): void => set_amount(Math.max(1, Math.min(item.amount, Math.round(value) || 1)))
  const fill = `${((amount - 1) / Math.max(1, item.amount - 1)) * 100}%`
  return (
    <form
      aria-label={text('amount_title')}
      className="trade-amount"
      onSubmit={(event) => {
        event.preventDefault()
        choose(amount)
      }}
    >
      <button className="trade-amount-back" onClick={close} type="button">
        <ChevronLeft size={16} />
        {text('inventory')}
      </button>
      <div className="trade-amount-item">
        <span className="trade-slot">
          <TradeSlotFace amount={1} item_type={item.item_type} level={item.level} name={item.name} />
        </span>
        <b>{item.name}</b>
        <small>{text('amount_owned', { count: item.amount })}</small>
      </div>
      <input
        aria-label={text('amount_title')}
        className="trade-amount-input"
        disabled={!can_edit}
        inputMode="numeric"
        max={item.amount}
        min={1}
        onChange={(event) => pick(Number(event.target.value))}
        type="number"
        value={amount}
      />
      <input
        aria-hidden="true"
        className="aui-range trade-amount-range"
        disabled={!can_edit}
        max={item.amount}
        min={1}
        onChange={(event) => pick(Number(event.target.value))}
        style={{ '--trade-fill': fill } as CSSProperties}
        tabIndex={-1}
        type="range"
        value={amount}
      />
      <div className="trade-amount-presets">
        {trade_amount_presets(item.amount).map((preset) => (
          <button
            aria-pressed={amount === preset.amount}
            disabled={!can_edit}
            key={preset.amount}
            onClick={() => set_amount(preset.amount)}
            type="button"
          >
            {preset.label ? text(preset.label) : preset.amount}
          </button>
        ))}
      </div>
      <Button className="trade-amount-submit" disabled={!can_edit} tone="primary" type="submit">
        {text('amount_offer', { count: amount })}
      </Button>
    </form>
  )
}

export const TradeInventory = ({
  items,
  can_edit,
  add_asset,
  picking,
  choose_amount,
  close_amount,
  balance,
  category_text,
  text,
  copy,
}: Readonly<{
  copy: AppCopy
  items: readonly ItemRow[]
  can_edit: boolean
  add_asset: (id: string) => void
  picking: Readonly<ItemRow> | null
  choose_amount: (amount: number) => void
  close_amount: () => void
  balance: bigint | null
  category_text: CopyText
  text: CopyText
}>) => {
  const [inspected, inspect] = useState<ItemRow | null>(null)
  const localized_numbers = useNumbers()
  const [category, set_category] = useState<TradeInventoryCategory>('equipment')
  const count = (key: TradeInventoryCategory): number =>
    items.filter((item) => trade_inventory_category(item) === key).length
  const visible = items.filter((item) => trade_inventory_category(item) === category)
  if (picking)
    return (
      <section className="trade-inventory">
        <TradeAmountPicker
          can_edit={can_edit}
          choose={choose_amount}
          close={close_amount}
          item={picking}
          key={picking.id}
          text={text}
        />
      </section>
    )
  return (
    <section className="trade-inventory">
      <header>
        <b>{text('inventory')}</b>
        <output aria-label={text('sui')} className="trade-wallet-balance">
          {balance === null ? '—' : localized_numbers.sui(balance, 2)}
          <SuiUnit size={10} />
        </output>
      </header>
      <nav className="trade-inventory-tabs">
        {TRADE_INVENTORY_CATEGORIES.map((key) => (
          <button aria-pressed={category === key} key={key} onClick={() => set_category(key)} type="button">
            {category_text(`bag_${key}`)}
            <span>{count(key)}</span>
          </button>
        ))}
      </nav>
      <div className="trade-inventory-grid">
        {visible.map((item) => (
          <button
            aria-label={`${text('amount_add')} ${item.name}`}
            className="trade-slot"
            disabled={!can_edit}
            draggable={can_edit}
            key={item.id}
            onClick={() => add_asset(item.id)}
            onContextMenu={(event) => {
              event.preventDefault()
              inspect(item)
            }}
            onDragStart={(event) => event.dataTransfer.setData('text/plain', item.id)}
            title={item.name}
            type="button"
          >
            <TradeSlotFace amount={item.amount} item_type={item.item_type} level={item.level} name={item.name} />
          </button>
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
