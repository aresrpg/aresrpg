// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// simulator/LoadoutSection.tsx — the character editor's EQUIPMENT half: the game's own paper doll, wired to
// the simulator's stored loadout instead of to the chain.
//
// Nothing here draws a slot: the doll, its slot cells, its icons and its cosmetic row are the inventory
// panel's components (EquipmentDoll → EquipmentSlot), and the picker is the app's shared SearchPickerModal —
// the same one the mob picker opens. What this file owns is the WIRING: loadout id → catalog row for the
// doll, and a picked row → the `loadout_set` input. Every offered item is the seeded template at its MAX
// roll (simulator/content.js's theorycraft ceiling), pets included as a first-class slot.

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { item_icon_url } from '@aresrpg/sdk/jobs'

import { SearchPickerModal, type PickerItem } from '../components/search_picker_modal'
import { CosmeticSlots, EquipmentDoll } from '../game/screens/hud/EquipmentDoll.jsx'
import { inventory_item_icon, SLOT_LABEL } from '../game/screens/hud/inventory-equip.js'

import { catalog_item, items_for_slot } from './content.js'
import type { SimCharacter } from './reducer'
import { use_simulator } from './store'

type CatalogItem = { id: string; name?: string; level?: number; quality?: string; category?: string }

/** The slot's caption — the paper doll's own vocabulary (`SLOT_LABEL`, the exact word an empty cell already
 *  prints), never a second label table. */
const slot_caption = (slot: string): string => ((SLOT_LABEL as Record<string, string>)[slot] ?? slot).toUpperCase()

export function LoadoutSection({ character }: Readonly<{ character: SimCharacter }>) {
  const { t } = useTranslation()
  const input = use_simulator((state) => state.input)
  const [picking, set_picking] = useState<string | null>(null)

  const slot_props = (slot: string) => ({
    slot,
    item: catalog_item(character.loadout[slot]),
    selected: false,
    valid: false,
    slug_by_name: {},
    on_activate: () => set_picking(slot),
    // The doll's own clear affordance (double-click a filled slot), wired to the same one door.
    on_unequip: () => input({ type: 'loadout_set', id: character.id, slot, template_id: null }),
  })

  return (
    <div className="flex flex-col gap-3">
      <EquipmentDoll slot_props={slot_props} flat />
      <CosmeticSlots slot_props={slot_props} />
      {picking && (
        <SlotPicker
          slot={picking}
          current={character.loadout[picking]}
          on_close={() => set_picking(null)}
          on_pick={(template_id) => {
            input({ type: 'loadout_set', id: character.id, slot: picking, template_id })
            set_picking(null)
          }}
        />
      )}
    </div>
  )
}

/**
 * One slot's item browser. The population is `items_for_slot` — the inventory's own slot-validity law, so
 * the weapon slot offers weapons and the pet slot offers pets, with no second eligibility rule here.
 * An EMPTY population is stated out loud (the seeded catalog ships empty in this repo, MISSING-ARTIFACT
 * #117): a slot with nothing to offer must say so, never render as a slot the player failed to use.
 */
function SlotPicker({
  slot,
  current,
  on_pick,
  on_close,
}: Readonly<{
  slot: string
  current: string | undefined
  on_pick: (template_id: string) => void
  on_close: () => void
}>) {
  const { t } = useTranslation()
  const caption = slot_caption(slot)
  const options = useMemo(() => items_for_slot(slot) as CatalogItem[], [slot])

  const items: PickerItem[] = useMemo(
    () =>
      options.map((item) => {
        const slug = inventory_item_icon({ ...item, slug: item.id })
        return {
          id: item.id,
          label: item.name || item.id,
          category: item.category,
          sublabel: t('simulator.item_level', { level: item.level ?? 0 }),
          icon: (slug ? item_icon_url(slug) : null) ?? undefined,
        }
      }),
    [options, t]
  )

  return (
    <SearchPickerModal
      title={t('simulator.pick_item', { slot: caption })}
      items={items}
      value={current}
      on_close={on_close}
      on_select={on_pick}
    />
  )
}
