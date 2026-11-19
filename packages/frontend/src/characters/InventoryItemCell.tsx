// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { ItemRow } from '@aresrpg/protocol'
import { InventoryCell } from '@aresrpg/ui'
import type { ButtonHTMLAttributes } from 'react'

import { useItemClick } from '../components/useItemClick.ts'
import { ItemDetailHover } from '../components/ItemSnapshotTooltip.tsx'
import { item_icon } from '../content/assets.ts'

type InventoryItemCellProps = Readonly<Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'>> &
  Readonly<{
    class_name?: string
    item: Readonly<Omit<ItemRow, 'kiosk'>>
    amount?: number
    show_level?: boolean
    pending?: boolean
  }>

/** The canonical compact inventory item. Every inventory subset reuses this exact cell. */
export const InventoryItemCell = ({
  item,
  show_level = false,
  amount = item.amount,
  title: _title,
  ...cell_props
}: InventoryItemCellProps) => {
  const on_click = useItemClick(cell_props.onClick, !!cell_props.onDoubleClick)
  return (
    <ItemDetailHover item={item}>
      <InventoryCell
        {...cell_props}
        id={item.id}
        label={item.name}
        icon={item_icon(item.item_type)}
        fallback={item.name.slice(0, 1).toUpperCase()}
        amount={amount}
        level={show_level ? item.level : null}
        onClick={on_click}
      />
    </ItemDetailHover>
  )
}
