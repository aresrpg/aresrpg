// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { ItemRow } from '@aresrpg/protocol'
import type { ButtonHTMLAttributes } from 'react'

import { useItemClick } from '../components/useItemClick.ts'
import { ItemDetailHover } from '../components/ItemSnapshotTooltip.tsx'
import { item_icon } from '../content/assets.ts'

type InventoryItemCellProps = Readonly<Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'>> &
  Readonly<{
    class_name?: string
    item: Readonly<ItemRow>
    amount?: number
    show_level?: boolean
  }>

/** The canonical compact inventory item. Every inventory subset reuses this exact cell. */
export const InventoryItemCell = ({
  class_name = '',
  item,
  show_level = false,
  amount = item.amount,
  title: _title,
  type = 'button',
  ...button_props
}: InventoryItemCellProps) => {
  const on_click = useItemClick(button_props.onClick, !!button_props.onDoubleClick)
  return (
    <ItemDetailHover item={item}>
      <button
        data-selection-id={item.id}
        className={`chr-cell ${class_name}`.trim()}
        aria-label={item.name}
        type={type}
        {...button_props}
        onClick={on_click}
      >
        {item_icon(item.item_type) ? (
          <img alt="" className="chr-cell__art" draggable={false} src={item_icon(item.item_type)!} />
        ) : (
          <span className="chr-cell__fallback">{item.name.slice(0, 1).toUpperCase()}</span>
        )}
        {amount > 1 && <span className="chr-cell__amount tabular-nums">×{amount}</span>}
        {show_level && <span className="chr-cell__lvl tabular-nums">{item.level}</span>}
      </button>
    </ItemDetailHover>
  )
}
