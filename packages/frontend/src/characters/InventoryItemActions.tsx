// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Button } from '@aresrpg/ui'
import type { ItemRow } from '@aresrpg/protocol'
import { Check } from 'lucide-react'

import { encyclopedia_catalog } from '../content/catalog.ts'
import type { AppCopy } from '../i18n/copy.ts'

import { natural_slot_for } from './equipment_stage.ts'
import { is_loot_box, type InventoryMenuEntry } from './InventoryOverlays.tsx'

export const primary_item_action = (
  item: Readonly<Pick<ItemRow, 'item_type' | 'category'>>,
  equipped: boolean
): 'equip' | 'unequip' | 'use' | null => {
  if (equipped) return 'unequip'
  if (is_loot_box(item)) return null
  if (encyclopedia_catalog.item(item.item_type)?.item.consumable) return 'use'
  return natural_slot_for(item, {}) ? 'equip' : null
}

export const InventoryItemActions = ({
  item,
  equipped,
  selected,
  disabled,
  can_use,
  entries,
  copy,
  activate,
  toggle,
  close,
}: Readonly<{
  item: Pick<ItemRow, 'item_type' | 'category'>
  equipped: boolean
  selected: boolean
  disabled: boolean
  can_use: boolean
  entries: readonly InventoryMenuEntry[]
  copy: AppCopy
  activate: () => void
  toggle: () => void
  close: () => void
}>) => {
  const action = primary_item_action(item, equipped)
  const labels = { equip: copy.ui.design_equip, unequip: copy.ui.mobile_unequip, use: copy.ui.inventory_use }
  return (
    <div className="inventory-item-actions">
      {!equipped && (
        <Button aria-pressed={selected} disabled={disabled} onClick={toggle}>
          <Check size={13} />
          {selected ? copy.ui.inventory_deselect : copy.ui.inventory_select}
        </Button>
      )}
      {entries.map(({ key, label, Icon, act, disabled: unavailable }) => (
        <Button
          key={key}
          tone={key === 'destroy' ? 'danger' : 'neutral'}
          disabled={disabled || unavailable}
          onClick={() => {
            act()
            close()
          }}
        >
          <Icon size={13} />
          {label}
        </Button>
      ))}
      {action && (
        <Button
          tone="primary"
          className="inventory-item-primary"
          disabled={disabled || (action === 'use' && !can_use)}
          onClick={activate}
        >
          {labels[action]}
        </Button>
      )}
    </div>
  )
}
