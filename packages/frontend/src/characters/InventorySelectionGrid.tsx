// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { character_equipment_slots, type CharacterEquipmentSlot } from '@aresrpg/immutable'
import type { ItemRow } from '@aresrpg/protocol'
import { Button, SelectionGrid } from '@aresrpg/ui'
import { MoreHorizontal, X } from 'lucide-react'
import { type ReactNode } from 'react'

import { copy_text, type AppCopy } from '../i18n/copy.ts'

import type { ItemMenuState } from './InventoryOverlays.tsx'

/** Both inventory presentations share gestures and the same selected-ID owner. */
export const InventorySelectionGrid = ({
  items,
  selected,
  change,
  menu,
  disabled,
  copy,
  children,
  class_name,
  drag_item,
  equip,
}: Readonly<{
  items: readonly ItemRow[]
  selected: readonly string[]
  change: (ids: readonly string[]) => void
  menu: (menu: ItemMenuState) => void
  disabled: boolean
  copy: AppCopy
  children: ReactNode
  class_name: string
  drag_item?: (id: string | null) => void
  equip: (item: Readonly<ItemRow>, slot: CharacterEquipmentSlot) => void
}>) => {
  const selected_items = items.filter(({ id }) => selected.includes(id))
  const drop = (id: string, point: Readonly<{ x: number; y: number }>): boolean => {
    const slot = document.elementFromPoint(point.x, point.y)?.closest<HTMLElement>('[data-equipment-slot]')
      ?.dataset.equipmentSlot
    const item = items.find((item) => item.id === id)
    if (!item || !character_equipment_slots.includes(slot as CharacterEquipmentSlot)) return false
    equip(item, slot as CharacterEquipmentSlot)
    return true
  }
  return (
    <>
      <div className="inventory-selection-tools">
        <span aria-live="polite">
          {copy_text(copy.ui)('inventory_selected_count', { count: selected_items.length })}
        </span>
        <Button
          aria-label={copy.ui.inventory_deselect}
          disabled={selected_items.length === 0 || disabled}
          onClick={() => change([])}
        >
          <X size={13} />
        </Button>
        <Button
          aria-label={copy.ui.mobile_item_actions}
          disabled={selected_items.length === 0 || disabled}
          onClick={(event) => {
            event.stopPropagation()
            const [item] = selected_items
            if (!item) return
            const bounds = event.currentTarget.getBoundingClientRect()
            menu({ item, items: selected_items, x: bounds.left, y: bounds.bottom })
          }}
        >
          <MoreHorizontal size={14} />
        </Button>
      </div>
      <SelectionGrid
        className={class_name}
        selected={selected}
        disabled={disabled}
        on_change={change}
        on_drag_item={drag_item}
        on_item_drop={drop}
      >
        {children}
      </SelectionGrid>
    </>
  )
}
