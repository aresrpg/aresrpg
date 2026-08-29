// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { ItemRow } from '@aresrpg/protocol'
import type { ButtonHTMLAttributes } from 'react'

import { item_icon } from '../content/assets.ts'

type InventoryItemCellProps = Readonly<Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'>> &
  Readonly<{
    class_name?: string
    item: Readonly<ItemRow>
    show_level?: boolean
  }>

/** The canonical compact inventory item. Every inventory subset reuses this exact cell. */
export const InventoryItemCell = ({
  class_name = '',
  item,
  show_level = false,
  title = item.name,
  type = 'button',
  ...button_props
}: InventoryItemCellProps) => (
  <button className={`chr-cell ${class_name}`.trim()} title={title} type={type} {...button_props}>
    {item_icon(item.item_type) ? (
      <img alt="" className="chr-cell__art" draggable={false} src={item_icon(item.item_type)!} />
    ) : (
      <span className="chr-cell__fallback">{item.name.slice(0, 1).toUpperCase()}</span>
    )}
    {item.amount > 1 && <span className="chr-cell__amount tabular-nums">×{item.amount}</span>}
    {show_level && <span className="chr-cell__lvl tabular-nums">{item.level}</span>}
  </button>
)
