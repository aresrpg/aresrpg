// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// simulator/LoadoutSection.tsx — the character editor's EQUIPMENT half: the game's own paper doll, wired to
// the simulator's stored loadout instead of to the chain.
//
// Nothing here draws a slot: the doll, its slot cells, its icons and its cosmetic row are the inventory
// panel's components (EquipmentDoll → EquipmentSlot), and the picker is the app's shared SearchPickerModal —
// the same one the mob picker opens. What this file owns is the WIRING: loadout id → live corpus row for the
// doll, and a picked row → the `loadout_set` input. Every offered item is the published template at its MAX
// roll (simulator/content.js's theorycraft ceiling), pets included as a first-class slot.
//
// The gear comes from pages/encyclopedia/item_corpus.ts — the live /v1 corpus. It used to come from the
// bundled seed catalog, which is empty by construction here, so all 20 pickers rendered blank on a real
// deployment.

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { item_icon_url } from '@aresrpg/sdk/jobs'

import { SearchPickerModal, type PickerItem } from '../components/search_picker_modal'
import { CosmeticSlots, EquipmentDoll } from '../game/screens/hud/EquipmentDoll.jsx'
import { inventory_item_icon, SLOT_LABEL } from '../game/screens/hud/inventory-equip.js'
import { items_for_slot } from '../game/screens/hud/simulator-equip.js'
import * as item_corpus from '../pages/encyclopedia/item_corpus'

import type { SimCharacter } from './reducer'
import { use_simulator } from './store'

/** The slot's caption — the paper doll's own vocabulary (`SLOT_LABEL`, the exact word an empty cell already
 *  prints), never a second label table. */
const slot_caption = (slot: string): string => ((SLOT_LABEL as Record<string, string>)[slot] ?? slot).toUpperCase()

export function LoadoutSection({ character }: Readonly<{ character: SimCharacter }>) {
  const input = use_simulator((state) => state.input)
  const [picking, set_picking] = useState<string | null>(null)
  const { by_id } = item_corpus.use_item_corpus()

  const slot_props = (slot: string) => ({
    slot,
    item: by_id.get(character.loadout[slot] ?? ''),
    selected: false,
    valid: false,
    slug_by_name: {},
    on_activate: () => set_picking(slot),
    // The doll's own clear affordance (double-click a filled slot), wired to the same one door.
    on_unequip: () => input({ type: 'loadout_set', id: character.id, slot, template_id: null }),
  })

  // COMPACT: in this dialog the doll is an INDEX of slots, not the drawer's hero art — a cell only has to be
  // a legible click target for its picker. Same shared component, one size prop (`compact`); the world
  // inventory keeps the stretching cells its drawer width is built for.
  return (
    <div className="flex flex-col gap-2 items-start">
      <EquipmentDoll slot_props={slot_props} flat compact />
      <CosmeticSlots slot_props={slot_props} compact />
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
 * One slot picker's whole CONTENT derivation, portal-free — the same split the mob picker uses, and for the
 * same reason: SearchPickerModal renders through `createPortal`, which this repo's SSR test harness cannot
 * resolve, so driving this hook is how the picker gets driven.
 *
 * The population filter is `items_for_slot` — equipment.move's own category→slot table — so the weapon slot
 * offers weapons and the pet slot offers pets, with no second eligibility rule here.
 *
 * `empty_label`: absence is NOT emptiness (cache law). While the corpus is still in flight the list says
 * LOADING; "NO RESULTS FOUND" over a cold corpus tells the player this slot has no gear in the game, which
 * is exactly the lie every one of these 20 pickers told while they read the empty bundled catalog.
 */
export function use_slot_picker_content(slot: string): { items: PickerItem[]; empty_label?: string } {
  const { t } = useTranslation()
  const { items: corpus, loading } = item_corpus.use_item_corpus()
  const options = useMemo(() => items_for_slot(slot, corpus), [slot, corpus])

  const items: PickerItem[] = useMemo(
    () =>
      options.map((item) => {
        // The icon key of a live row IS its authored art slug (`item_type`) — the shared resolver reads it.
        const slug = inventory_item_icon(item)
        return {
          id: item.id,
          label: item.name || item.id,
          category: item.category,
          sublabel: t('simulator.item_level', { level: item.level }),
          icon: (slug ? item_icon_url(slug) : null) ?? undefined,
        }
      }),
    [options, t]
  )

  return { items, empty_label: loading ? t('simulator.item_corpus_loading') : undefined }
}

/** The picker shell — a pass-through over the hook above. */
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
  const { items, empty_label } = use_slot_picker_content(slot)

  return (
    <SearchPickerModal
      title={t('simulator.pick_item', { slot: slot_caption(slot) })}
      items={items}
      empty_label={empty_label}
      value={current}
      on_close={on_close}
      on_select={on_pick}
    />
  )
}
