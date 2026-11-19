// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The compact inventory cell: item art, lot size and level. Every inventory subset reuses it.

import type { ButtonHTMLAttributes } from 'react'

export type InventoryCellProps = Readonly<Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'>> &
  Readonly<{
    id: string
    label: string
    /** The item art; the fallback letter shows when it is missing. */
    icon: string | null
    fallback: string
    amount: number
    /** Shown in the corner when present. */
    level: number | null
    pending?: boolean
    class_name?: string
  }>

export const InventoryCell = ({
  id,
  label,
  icon,
  fallback,
  amount,
  level,
  pending,
  class_name = '',
  type = 'button',
  ...button_props
}: InventoryCellProps) => (
  <button
    data-selection-id={id}
    className={`chr-cell ${class_name}`.trim()}
    aria-label={label}
    aria-busy={pending}
    type={type}
    {...button_props}
  >
    {icon ? (
      <img alt="" className="chr-cell__art" draggable={false} src={icon} />
    ) : (
      <span className="chr-cell__fallback">{fallback}</span>
    )}
    <span className="inventory-item-pending" hidden={!pending} aria-hidden="true" />
    {amount > 1 && <span className="chr-cell__amount">×{amount}</span>}
    {level !== null && <span className="chr-cell__lvl">{level}</span>}
  </button>
)
