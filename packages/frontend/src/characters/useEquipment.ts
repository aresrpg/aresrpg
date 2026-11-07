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
  equipment_commit_refusal,
  equipment_map_of,
  natural_slot_for,
  stage_equip,
  stage_unequip,
  type EquipmentMap,
} from './equipment_stage.ts'
import { select_inventory_item } from './inventory_selection.ts'
import { is_loot_box, type ItemMenuState } from './InventoryOverlays.tsx'
import { bag_item_matches, type BagCategory, type ResourceFilter } from './InventoryResourceFilters.tsx'

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
  const [pending_equipment, set_pending_equipment] = useState<EquipmentMap | null>(null)
  const [category, set_category] = useState<BagCategory>('equipment')
  const [resource_filter, set_resource_filter] = useState<ResourceFilter>('all')
  const [inspected_id, set_inspected_id] = useState<string | null>(null)
  const [selected_ids, set_selected_ids] = useState<readonly string[]>([])
  const [dragging_id, set_dragging_id] = useState<string | null>(null)
  const [committing, set_committing] = useState(false)
  const [menu, set_menu] = useState<ItemMenuState>(null)
  const [reveal_box, set_reveal_box] = useState<ItemRow | null>(null)
  const [healing_item, set_healing_item] = useState<Readonly<ItemRow> | null>(null)

  const equipment = pending_equipment ?? real
  const changes = useMemo(() => equipment_change_set(equipment, real), [equipment, real])
  const equipped_ids = useMemo(
    () => new Set(Object.values(equipment).flatMap((item) => (item ? [item.id] : []))),
    [equipment]
  )

  // Pending removals remain visible in the bag until the certified result or failure restores it.
  const freed = useMemo(
    () =>
      character.equipment
        .filter(({ id }) => !equipped_ids.has(id))
        .map(({ slot: _slot, ...item }) => ({ ...item, kiosk: character.kiosk })),
    [character, equipped_ids]
  )
  const bag = useMemo(
    () => [...inventory.filter((item) => !equipped_ids.has(item.id)), ...freed],
    [inventory, equipped_ids, freed]
  )
  const display_bag = useMemo(() => inventory_groups(bag), [bag])
  const grid_items = useMemo(
    () => display_bag.filter(({ item }) => bag_item_matches(item, category, resource_filter)),
    [display_bag, category, resource_filter]
  )

  const selected_items = grid_items.map(({ item }) => item).filter(({ id }) => selected_ids.includes(id))
  const select_item = (item: Readonly<ItemRow>, toggle: boolean): void => {
    if (committing) return
    if (toggle) set_selected_ids(select_inventory_item(selected_ids, item.id, true))
    else set_inspected_id(item.id)
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
      const amount = mode === 'full' ? plan.maximum_amount : 1
      if (plan.needed === 0) throw localized_error(t('already_full_hp'))
      if (plan.available < 1) throw localized_error(t('consume_healing_insufficient', { count: 1 }))
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
        if (read_app_state().session.wallet !== wallet) return pending.dismiss()
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

  const commit = (next: EquipmentMap): void => {
    if (committing) return
    const requested = equipment_change_set(next, real)
    if (!requested.to_equip.length && !requested.to_unequip.length) return
    if (session) {
      const refusal = equipment_commit_refusal({
        character,
        current: character,
        equipment: next,
        inventory,
        blocked: encumbered_ids,
      })
      if (refusal) return void toast.add(t(`refusal_${refusal}`), 'info')
      session.commit(next)
      return
    }
    if (!wallet) return
    const transaction = run_direct_transaction(() => {
      const state = read_app_state()
      const current = editable_character(state, character.id, Date.now())
      const blocked = encumbered_asset_ids(state.marketplace.own_listings, state.trade.rows)
      const refusal = equipment_commit_refusal({
        character,
        current,
        equipment: next,
        inventory: state.session.inventory,
        blocked,
      })
      if (state.session.wallet !== wallet || refusal) throw localized_error(t(`refusal_${refusal ?? 'unavailable'}`))
      return wallet.character.equip({
        character_id: character.id,
        ...requested,
        custody: { kiosk: current!.kiosk, kiosk_cap: current!.kiosk_cap },
      })
    })
    if (!transaction) return
    set_committing(true)
    set_pending_equipment(next)
    const pending = toast.loading(t('equip_pending'))
    void transaction
      .then(() => {
        if (read_app_state().session.wallet !== wallet) return pending.dismiss()
        dispatch_app({
          type: 'character/equip_folded',
          character_id: character.id,
          equipped: requested.to_equip,
          unequipped: requested.to_unequip,
        })
        pending.success(t('equip_success'))
      })
      .catch(pending.error)
      .finally(() => {
        set_pending_equipment(null)
        set_committing(false)
      })
  }

  const equip = (item: Readonly<ItemRow>, slot: CharacterEquipmentSlot | null): void => {
    if (committing) return
    const target = slot ?? natural_slot_for(item, real)
    if (!target) return void toast.add(t('refusal_wrong_slot'), 'info')
    if (!refuse(item, target)) commit(stage_equip(real, item, target))
  }
  const unequip = (slot: CharacterEquipmentSlot): void => commit(stage_unequip(real, slot))

  const activate = (item: Readonly<ItemRow>): void => {
    if (committing) return
    if (encumbered_ids.has(item.id)) return void toast.add(t('refusal_item_listed'), 'info')
    if (is_loot_box(item)) return set_reveal_box(item)
    const effect = encyclopedia_catalog.item(item.item_type)?.item.consumable
    if (effect) return effect.type === 'heal' ? set_healing_item(item) : drink(item)
    equip(item, null)
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
    equipped_ids,
    freed,
    bag,
    display_bag,
    grid_items,
    selected_items,
    select_item,
    inspected,
    equip,
    unequip,
    drink,
    activate,
    totals,
    empty_cells,
  }
}
