// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { CharacterEquipmentSlot } from '@aresrpg/immutable'
import { item_stat_center, stat_names } from '@aresrpg/immutable'
import type { CharacterRow, ItemRow } from '@aresrpg/protocol'
import { useMemo, useState } from 'react'

import { encyclopedia_catalog } from '../content/catalog.ts'
import { fold_equipment_stats } from '../game/character_stats.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { localized_error } from '../i18n/error_text.ts'
import { available_inventory_items, encumbered_asset_ids, inventory_groups } from '../inventory_stacks.ts'
import { dispatch_app, read_app_state, useAppStore } from '../store.ts'
import { toast } from '../toast.ts'
import { run_direct_transaction } from '../transaction_guard.ts'

import type { CharacterSession } from './character_session.ts'
import { editable_character } from './character_activity.ts'
import { consumable_plan } from './consumable_plan.ts'
import {
  equip_refusal,
  equipment_change_set,
  equipment_map_of,
  natural_slot_for,
  stage_equip,
  type EquipmentMap,
} from './equipment_stage.ts'
import { select_inventory_item } from './inventory_selection.ts'
import { is_loot_box, type ItemMenuState } from './InventoryOverlays.tsx'
import {
  bag_category_of,
  bag_item_matches,
  type BagCategory,
  type ResourceFilter,
} from './InventoryResourceFilters.tsx'

const consumable_action = (item: Readonly<ItemRow>) => {
  const effect = encyclopedia_catalog.item(item.item_type)?.item.consumable
  if (!effect || effect.type === 'loot_box') return null
  return Object.freeze({
    effect,
    heal: effect.type === 'heal' ? effect.amount : 0,
  })
}

const MIN_GRID_CELLS = 40

export function useEquipment({
  character,
  copy,
  session,
}: Readonly<{ character: Readonly<CharacterRow>; copy: AppCopy; session?: CharacterSession }>) {
  const t = copy_text(copy.characters_page)
  const wallet = useAppStore(({ session }) => session.wallet)
  const available = useAppStore((state) => editable_character(state, character.id, Date.now()))
  const stored_inventory = useAppStore(({ session }) => session.inventory)
  const all_inventory = session?.inventory ?? stored_inventory
  const listings = useAppStore(({ marketplace }) => marketplace.own_listings)
  const trades = useAppStore(({ trade }) => trade.rows)
  const encumbered_ids = useMemo(() => encumbered_asset_ids(listings, trades), [listings, trades])
  const inventory = useMemo(
    () => available_inventory_items(all_inventory, encumbered_ids, character.kiosk),
    [all_inventory, character.kiosk, encumbered_ids]
  )
  const real = useMemo(() => equipment_map_of(character), [character])
  const [staged, set_staged] = useState<EquipmentMap | null>(null)
  const [category, set_category] = useState<BagCategory>('equipment')
  const [resource_filter, set_resource_filter] = useState<ResourceFilter>('all')
  const [inspected_id, set_inspected_id] = useState<string | null>(null)
  const [selected_ids, set_selected_ids] = useState<readonly string[]>([])
  const [dragging_id, set_dragging_id] = useState<string | null>(null)
  const [committing, set_committing] = useState(false)
  const [menu, set_menu] = useState<ItemMenuState>(null)
  const [reveal_box, set_reveal_box] = useState<ItemRow | null>(null)
  const [healing_item, set_healing_item] = useState<Readonly<ItemRow> | null>(null)

  const equipment = staged ?? real
  const changes = useMemo(() => equipment_change_set(equipment, real), [equipment, real])
  const dirty = changes.to_equip.length > 0 || changes.to_unequip.length > 0
  const staged_ids = useMemo(
    () => new Set(Object.values(equipment).flatMap((item) => (item ? [item.id] : []))),
    [equipment]
  )

  // items whose unequip is STAGED come back to the bag view immediately (re-clickable to
  // cancel); they leave the doll but must never vanish from both surfaces at once
  const freed = useMemo(
    () =>
      character.equipment
        .filter(({ id }) => !staged_ids.has(id))
        .map(({ slot: _slot, ...item }) => ({ ...item, kiosk: character.kiosk })),
    [character, staged_ids]
  )
  const bag = useMemo(
    () => [...inventory.filter((item) => !staged_ids.has(item.id)), ...freed],
    [inventory, staged_ids, freed]
  )
  const display_bag = useMemo(() => inventory_groups(bag), [bag])
  const counts = useMemo(
    () =>
      display_bag.reduce(
        (totals, { item }) => ({ ...totals, [bag_category_of(item)]: totals[bag_category_of(item)] + 1 }),
        {
          equipment: 0,
          consumables: 0,
          resources: 0,
        }
      ),
    [display_bag]
  )
  const grid_items = useMemo(
    () => display_bag.filter(({ item }) => bag_item_matches(item, category, resource_filter)),
    [display_bag, category, resource_filter]
  )

  const selected_items = grid_items.map(({ item }) => item).filter(({ id }) => selected_ids.includes(id))
  const select_item = (item: Readonly<ItemRow>, toggle: boolean): void => {
    set_inspected_id(item.id)
    if (toggle) set_selected_ids(select_inventory_item(selected_ids, item.id, true))
  }

  const inspected =
    bag.find(({ id }) => id === inspected_id) ??
    Object.values(equipment).find((item) => item?.id === inspected_id) ??
    null

  const refuse = (item: Readonly<ItemRow>, slot: CharacterEquipmentSlot): boolean => {
    const refusal = equip_refusal({
      item,
      slot,
      character_level: character.level,
      equipment,
      listed_ids: encumbered_ids,
    })
    if (refusal) toast.add(t(`refusal_${refusal}`), 'info')
    return refusal !== null
  }

  const try_stage = (item: Readonly<ItemRow>, slot: CharacterEquipmentSlot | null): void => {
    if (committing) return
    const target = slot ?? natural_slot_for(item, equipment)
    if (!target) return void toast.add(t('refusal_wrong_slot'), 'info')
    if (refuse(item, target)) return
    set_staged(stage_equip(equipment, item, target))
  }

  const drink = (item: Readonly<ItemRow>, mode: 'one' | 'full' = 'one'): void => {
    const action = consumable_action(item)
    if (!action || !wallet) return
    if (!available) return void toast.add(t('consume_busy'), 'info')
    if (action.effect.type === 'city' && !character.world) return
    const transaction = run_direct_transaction(async () => {
      const state = read_app_state()
      const current_character = editable_character(state, character.id, Date.now())
      if (!current_character) throw localized_error(t('consume_busy'))
      if (current_character.dungeon_run && ['recall', 'city'].includes(action.effect.type))
        throw localized_error(t('teleport_dungeon_blocked'))
      const encumbered = encumbered_asset_ids(state.marketplace.own_listings, state.trade.rows)
      const plan = consumable_plan(current_character, item, state.session.inventory, encumbered, Date.now())
      const amount = mode === 'full' ? plan.needed : 1
      if (plan.needed === 0) throw localized_error(t('already_full_hp'))
      if (amount > plan.available) throw localized_error(t('consume_healing_insufficient', { count: amount }))
      const result = await wallet.character.use_consumable({
        character_id: character.id,
        item_id: item.id,
        item_type: item.item_type,
        amount,
        merge_sources: plan.merge_sources,
        ...(action.effect.type === 'city' ? { world: current_character.world } : {}),
        custody: { kiosk: current_character.kiosk, kiosk_cap: current_character.kiosk_cap },
      })
      return { ...result, amount }
    })
    if (!transaction) return
    set_healing_item(null)
    set_committing(true)
    const pending = toast.loading(t('consume_pending'))
    void transaction
      .then(({ digest, inventory_changes, amount }) => {
        if (read_app_state().session.wallet !== wallet) return
        dispatch_app({ type: 'inventory/amounts_changed', changes: inventory_changes })
        dispatch_app({
          type: 'character/consumed',
          digest,
          character_id: character.id,
          item_id: item.id,
          effect: action.effect.type,
          heal: action.heal * amount,
        })
        pending.success(t('consume_success'))
      })
      .catch(pending.error)
      .finally(() => set_committing(false))
  }

  const activate = (item: Readonly<ItemRow>): void => {
    if (encumbered_ids.has(item.id)) return void toast.add(t('refusal_item_listed'), 'info')
    if (is_loot_box(item)) return set_reveal_box(item)
    const effect = encyclopedia_catalog.item(item.item_type)?.item.consumable
    if (effect) return effect.type === 'heal' ? set_healing_item(item) : drink(item)
    try_stage(item, null)
  }

  const accept = (): void => {
    if (!dirty || committing) return
    if (session) {
      session.commit(equipment)
      set_staged(null)
      return
    }
    if (!wallet) return
    const transaction = run_direct_transaction(() =>
      wallet.character.equip({
        character_id: character.id,
        to_equip: changes.to_equip,
        to_unequip: changes.to_unequip,
        custody: { kiosk: character.kiosk, kiosk_cap: character.kiosk_cap },
      })
    )
    if (!transaction) return
    set_committing(true)
    const pending = toast.loading(t('equip_pending'))
    void transaction
      .then(() => {
        dispatch_app({
          type: 'character/equip_folded',
          character_id: character.id,
          equipped: changes.to_equip,
          unequipped: changes.to_unequip,
        })
        set_staged(null)
        pending.success(t('equip_success'))
      })
      .catch(pending.error)
      .finally(() => set_committing(false))
  }

  const totals = useMemo(() => {
    // the ONE fold home (clamped, pet-scaled) — display exactly what the chain folds
    const folded = fold_equipment_stats(Object.values(equipment).flatMap((item) => (item ? [item] : [])))
    return stat_names
      .map((stat) => ({ stat, value: folded[stat] - item_stat_center }))
      .filter(({ value }) => value !== 0)
  }, [equipment])

  const empty_cells = Math.max(0, MIN_GRID_CELLS - grid_items.length)

  return {
    t,
    wallet,
    available,
    all_inventory,
    listings,
    trades,
    encumbered_ids,
    inventory,
    real,
    staged,
    set_staged,
    category,
    set_category,
    resource_filter,
    set_resource_filter,
    inspected_id,
    set_inspected_id,
    selected_ids,
    set_selected_ids,
    dragging_id,
    set_dragging_id,
    committing,
    menu,
    set_menu,
    reveal_box,
    set_reveal_box,
    healing_item,
    set_healing_item,
    equipment,
    changes,
    dirty,
    staged_ids,
    freed,
    bag,
    display_bag,
    counts,
    grid_items,
    selected_items,
    select_item,
    inspected,
    try_stage,
    drink,
    activate,
    accept,
    totals,
    empty_cells,
  }
}
