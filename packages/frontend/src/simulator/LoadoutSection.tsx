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

import { ItemTooltipCard } from '../components/item_hover_tooltip'
import { useMouseTooltip } from '../components/items'
import { SearchPickerModal, type PickerItem } from '../components/search_picker_modal'
import { CosmeticSlots, EquipmentDoll } from '../game/screens/hud/EquipmentDoll.jsx'
import { inventory_item_icon, SLOT_LABEL } from '../game/screens/hud/inventory-equip.js'
import { items_for_slot, max_roll_stats } from '../game/screens/hud/simulator-equip.js'
import * as item_corpus from '../pages/encyclopedia/item_corpus'
import type { CorpusItem } from '../pages/encyclopedia/item_corpus'

import type { SimCharacter } from './reducer'
import { use_simulator } from './store'

/** The slot's caption — the paper doll's own vocabulary (`SLOT_LABEL`, the exact word an empty cell already
 *  prints), never a second label table. */
const slot_caption = (slot: string): string => ((SLOT_LABEL as Record<string, string>)[slot] ?? slot).toUpperCase()

export function LoadoutSection({ character }: Readonly<{ character: SimCharacter }>) {
  const input = use_simulator((state) => state.input)
  const [picking, set_picking] = useState<string | null>(null)
  const { by_id } = item_corpus.useItemCorpus()
  // WHAT IS ON THE DOLL, without unequipping it to find out. The chain inventory already answers this on its
  // own paper doll through EquipmentSlot's hover seam and ONE tooltip instance for the whole panel
  // (Inventory.jsx / useOnchainItemTooltip); this is the same seam and the same shared card, fed the live
  // corpus row instead of a chain template — so the equipped tiles and the picker rows that fill them show
  // the identical detail, at the identical roll.
  const { on_mouse_enter, on_mouse_move, on_mouse_leave, tooltip_element } = useMouseTooltip<CorpusItem>((item) => (
    <MaxRollItemCard item={item} />
  ))

  const slot_props = (slot: string) => ({
    slot,
    item: by_id.get(character.loadout[slot] ?? ''),
    selected: false,
    valid: false,
    slug_by_name: {},
    on_activate: () => set_picking(slot),
    // The doll's own clear affordance (double-click a filled slot), wired to the same one door.
    on_unequip: () => input({ type: 'loadout_set', id: character.id, slot, template_id: null }),
    // EquipmentSlot fires these on FILLED cells only, handing back the row it is rendering.
    on_hover_enter: on_mouse_enter,
    on_hover_move: on_mouse_move,
    on_hover_leave: on_mouse_leave,
  })

  // COMPACT: in this dialog the doll is an INDEX of slots, not the drawer's hero art — a cell only has to be
  // a legible click target for its picker. Same shared component, one size prop (`compact`); the world
  // inventory keeps the stretching cells its drawer width is built for.
  return (
    <div className="flex flex-col gap-2 items-start">
      <EquipmentDoll slot_props={slot_props} flat compact />
      <CosmeticSlots slot_props={slot_props} compact />
      {tooltip_element}
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
 * LOADING; if the /v1 read failed it says UNAVAILABLE. Only a successful corpus read may fall through to
 * "NO RESULTS FOUND" for a slot the game genuinely has no gear for.
 */
export function useSlotPickerContent(slot: string): { items: PickerItem[]; empty_label?: string } {
  const { t } = useTranslation()
  const { items: corpus, loading, error } = item_corpus.use_item_corpus()
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

  return {
    items,
    empty_label: error ? t('rpc.unavailable') : loading ? t('simulator.item_corpus_loading') : undefined,
  }
}

/**
 * One published row → the shape the shared item card renders (#883 ⑦). It is the SAME projection the
 * encyclopedia's item pane feeds that component: damage lines straight off the /v1 row, art through the one
 * icon resolver. Nothing is invented — a template carries no rarity in this game (the quality tiers died with
 * the concept), and `stats_unavailable` belongs to owned instances whose roll is still pending, never to a
 * template that authors its ranges in the open.
 *
 * STATS ARE THE MAX ROLL, not the authored range, because this is the SIMULATOR: every offered item is
 * equipped at its ceiling, so the range `+2 to +7` describes a roll no build here ever gets. The card reads
 * through `max_roll_stats` — the same rule the stat fold equips through — so an item's card and the `(+X)` it
 * adds to a stat row are arithmetically the same fact. Callers label the context (`simulator.max_roll`).
 */
export const picker_item_detail = (item: CorpusItem) => {
  const slug = inventory_item_icon(item)
  return {
    id: item.id,
    image_url: (slug ? item_icon_url(slug) : null) ?? undefined,
    name: item.name || item.id,
    category: item.category,
    rarity: '',
    level: item.level,
    stats: max_roll_stats(item) as Record<string, number>,
    damages: item.damages,
    description: item.description,
  }
}

/**
 * THE simulator's item hover card: the shared ItemDetailView chrome, fed the max-roll projection above and
 * footed with the MAX ROLL micro-label so the ceiling never reads as an ordinary roll.
 */
export function MaxRollItemCard({ item }: Readonly<{ item: CorpusItem }>) {
  const { t } = useTranslation()
  return (
    <ItemTooltipCard item={picker_item_detail(item)}>
      <span className="text-[9px] tracking-[0.22em] uppercase" style={{ color: '#c8963c' }}>
        {t('simulator.max_roll')}
      </span>
    </ItemTooltipCard>
  )
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
  const { items, empty_label } = useSlotPickerContent(slot)
  const { by_id } = item_corpus.useItemCorpus()

  return (
    <SearchPickerModal
      title={t('simulator.pick_item', { slot: slot_caption(slot) })}
      items={items}
      empty_label={empty_label}
      value={current}
      on_close={on_close}
      on_select={on_pick}
      // WHAT IT DOES, BEFORE THE PICK. Twenty slots against a whole published catalog is a lot of blind
      // equipping otherwise: the row hover (long-press on touch — the picker's own gesture) shows the
      // game's item card, the same one the encyclopedia and the bag render.
      render_tooltip={(id) => {
        const row = by_id.get(id)
        return row ? <MaxRollItemCard item={row} /> : null
      }}
    />
  )
}
