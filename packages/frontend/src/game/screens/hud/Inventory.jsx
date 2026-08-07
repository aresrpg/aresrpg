// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useMemo, useReducer, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { slugs } from 'virtual:item_catalog'

import { xp_progress } from '@aresrpg/sdk/experience'

import { use_auth } from '../../../auth'
import { get_owner_items } from '../../../rpc/client'
import { useGameState } from '../../store.js'
import { equip_items } from '../../../world-shell/equip_actions.js'
import { legacy_pet_equip_guard } from '../../../world-shell/pet_equip_guard.js'
import { use_consumable_batched } from '../../../world-shell/consumable_actions.js'
import { mark_ui_updated } from '../../../world-shell/tx.js'
import { reconcile_equip_state } from '../../../world-shell/equip_state_refresh.js'
import { remove_bag_items, add_bag_items, apply_worn_receipt } from '../../../world-shell/store_patch.js'
import { use_toast } from '../../../toast'
import { PLACEHOLDER_SPRITES, class_sprite_base, class_title } from '../../data/classes.js'
import { color_to_hue } from '../../data/color.js'
import { resolve_rolled_stats } from '../../../chain/rolled_stats.js'
import { CharacterPortrait } from './CharacterPortrait.jsx'
import { is_lootbox } from '../../../world-shell/lootbox_actions.js'
import {
  EQUIPMENT_SLOTS,
  WORN_CATEGORIES,
  can_consume,
  equip_lock_of,
  equipment_change_set,
  equip_stage_action,
  equipped_totals,
  is_consumable,
  is_item_listed,
  is_slot_valid,
  invalid_equip_change,
  partition_bag,
  real_equipment_of,
  stage_reducer,
  wallet_equipped_ids,
} from './inventory-equip.js'
import { equip_preflight } from './inventory_context_actions'
import { CosmeticSlots, EquipmentDoll } from './EquipmentDoll.jsx'
import { EquipmentLockNotice } from './EquipmentLockNotice.jsx'
import { InventoryBag } from './InventoryBag.jsx'
import { InventoryOverlays } from './InventoryOverlays.jsx'
import {
  allow_equip_retry,
  block_equip_retry,
  block_equip_state_refresh,
  is_box_retry_blocked,
  is_equip_retry_blocked,
  is_equip_state_stale,
} from './lootbox-retry-guard.js'
import { useInventoryMenus } from './use_inventory_menus.js'
import { is_template_removed } from '../../../components/orphan_item'
import './hud-panels.css'
import { game_log } from '../../../core/log.js'
import { useInventoryTemplates } from './use_inventory_templates.jsx'

const TABS = /** @type {const} */ ([
  ['equipment', 'inventory.tab_equipment'],
  ['cosmetics', 'inventory.cosmetics'],
  ['consumables', 'inventory.tab_consumables'],
  ['resources', 'inventory.tab_resources'],
])

/** @returns {import('react').JSX.Element} */
export function Inventory() {
  const { t } = useTranslation()
  const address = use_auth((state) => state.address)
  const items = useGameState((s) => s.sui.items)
  const characters = useGameState((s) => s.sui.characters)
  const selected_character_id = useGameState((s) => s.selected_character_id)
  const {
    template_map,
    template_id_map,
    food_slugs,
    pet_max_stats_by_template_id,
    rolled_stats_by_id,
    set_rolled_stats_by_id,
    on_item_hover,
    on_item_hover_move,
    dismiss_item_tooltip,
    set_hovered_bag_id,
    tooltip_element,
  } = useInventoryTemplates(items, slugs)

  const [, refresh_retry_guard] = useState(0)
  const {
    pet_menu,
    set_pet_menu,
    feed_modal,
    set_feed_modal,
    crush_menu,
    set_crush_menu,
    crush_confirm,
    set_crush_confirm,
    box_menu,
    set_box_menu,
    reveal_box,
    set_reveal_box,
    equip_menu,
    set_equip_menu,
    to_reveal_box,
    on_grid_context_menu,
    on_box_retry_blocked,
    on_box_retry_allowed,
  } = useInventoryMenus({ t, slugs, refresh_retry_guard })

  const character = useMemo(
    () => characters?.find((c) => c.id === selected_character_id) ?? null,
    [characters, selected_character_id]
  )

  const real_equipment = useMemo(
    // items = the /v1 owner-items feed, joined by item id purely as display identity (equipped items
    // stay kiosk-locked so their docs are present) — keeps the doll painting name/icon on a cold template map.
    () => real_equipment_of(character, template_map, template_id_map, items),
    [character, template_map, template_id_map, items]
  )

  const [stage, dispatch_stage] = useReducer(stage_reducer, {
    equipment: real_equipment,
    dirty: false,
  })
  const [category, set_category] = useState('equipment')
  const [selected_item_id, set_selected_item_id] = useState(/** @type {string | null} */ (null))
  const [dragging_item, set_dragging_item] = useState(/** @type {any} */ (null))
  const [committing, set_committing] = useState(false)

  const equipment = stage.dirty || stage.committed ? stage.equipment : real_equipment

  useEffect(() => {
    let alive = true
    const equipped_item_ids = [
      ...new Set(EQUIPMENT_SLOTS.map((slot) => equipment[slot]?.id).filter((item_id) => item_id)),
    ]
    const rolled_stat_reads = equipped_item_ids.map((item_id) =>
      resolve_rolled_stats(item_id)
        .catch((error) => {
          game_log('inventory', 'equipped item rolled-stat read failed', { item_id, error })
          return null
        })
        .then((rolled_stats) => [item_id, rolled_stats])
    )
    void Promise.all(rolled_stat_reads).then((rolled_stat_entries) => {
      if (!alive) return
      set_rolled_stats_by_id((current_stats) => ({ ...current_stats, ...Object.fromEntries(rolled_stat_entries) }))
    })
    return () => {
      alive = false
    }
  }, [equipment])

  if (!character) {
    return <div className="hud-panel__empty">No character selected</div>
  }

  const equip_retry_blocked = is_equip_retry_blocked(character.id)
  const equip_state_stale = is_equip_state_stale(character.id)
  // Lock reason as data (equip_lock_of): `inline` gates the panel notice — the transient pending tx is
  // toast-owned (use_toast.promise below), so it must never render the in-panel box (night-batch #2).
  // #590 — the LOCK is the tx-in-flight signal ONLY: `committing` is held across the reconcile and cleared
  // in on_accept's `finally`, so a reconcile that fails on /v1 indexer lag can never strand the panel. The
  // post-success optimistic `stage.committed` drives DISPLAY (the `equipment` map below) but MUST NOT lock —
  // conflating it here left "Updating equipment…" latched forever, silently eating every later unequip.
  const lock = equip_lock_of({
    pending: committing,
    retry_blocked: equip_retry_blocked,
    state_stale: equip_state_stale,
    in_dungeon: !!character.in_dungeon,
    exploring: !!character.exploring,
  })
  const equip_lock = lock ? t(lock.key) : null
  const refresh_equip_state = async () => {
    try {
      await reconcile_equip_state(
        { address, character_id: character.id },
        { is_current: () => use_auth.getState().address === address }
      )
    } catch (error) {
      game_log('inventory', 'equip retry reconcile failed', { character_id: character.id, error })
      return
    }
    allow_equip_retry(character.id)
    refresh_retry_guard((version) => version + 1)
    use_toast.getState().add(t('errors.tx_retry_cleared'), 'info')
  }

  const hue = color_to_hue(character.color_1 ?? 0)
  const { level } = xp_progress(character.experience)

  const equipped_ids = new Set(EQUIPMENT_SLOTS.map((slot) => equipment[slot]?.id).filter(Boolean))

  // Bag partition (partition_bag — pure, one home): `excluded_ids` subtracts items equipped by the
  // wallet's OTHER characters (night-batch #4 — equip keeps items kiosk-locked, §11, so /v1/owner-items
  // unions them into every bag); the selected character's own equipment stays governed by `equipped_ids`.
  const { owned, counts, total_count, grid_items, empty_count } = partition_bag(items, {
    equipped_ids,
    excluded_ids: wallet_equipped_ids(characters, selected_character_id),
    category,
  })

  const totals = equipped_totals(equipment, rolled_stats_by_id, template_id_map, template_map)

  const dragging = (/** @type {DragEvent | any} */ e) =>
    owned.find((item) => item.id === e.dataTransfer.getData('text/plain')) ?? null

  // #31/D307 — drink a consumable from the bag: every click paints INSTANTLY (per-unit optimistic decrement;
  // the cell disappears on its last unit) and folds into ONE trailing batched tx (~500ms after the last
  // click) carrying the accumulated amount. Toasts / failure rollback / chain reconcile all live in the batch
  // home (consumable_actions.js): one toast per BATCH, failure drains the ledger + refetches authoritative.
  const use_bag_consumable = (/** @type {any} */ item) => {
    if (!character) return // need a character to heal (bag can render with none selected)
    // PRE-CHECK ("you already know that"): a heal consumable on a full-HP character can
    // only abort on-chain — refuse BEFORE the optimistic decrement and BEFORE any tx. Zero tx, one toast.
    if (!can_consume(character)) {
      use_toast.getState().add(t('inventory.already_full_hp'), 'info')
      return
    }
    use_consumable_batched({ character_id: character.id, potion_id: item.id, item_type: item.item_type })
  }

  /** Double-click / click an item in the grid → equip (consumables → use). */
  const on_grid_activate = (/** @type {any} */ item) => {
    if (is_item_listed(item)) {
      use_toast.getState().add(t('errors.item_listed_for_sale'), 'info')
      return
    }
    if (is_lootbox(item.item_type) && is_box_retry_blocked(item.id)) {
      use_toast.getState().add(t('lootbox.retry_blocked'), 'info')
      return
    }
    // ORPHAN guard: a removed-template item can't be equipped OR used (both PTBs
    // need the deleted &ItemTemplate) — refuse in plain language and point at the one path that survives (crush).
    if (is_template_removed(item, template_map)) {
      use_toast.getState().add(t('removed_item.cannot_use'), 'info')
      return
    }
    // A pet loot-box is is_consumable, so intercept BEFORE the drink branch — open it (reveal) instead of "drinking".
    if (is_lootbox(item.item_type)) {
      set_reveal_box(to_reveal_box(item))
      return
    }
    if (is_consumable(item)) {
      use_bag_consumable(item)
      return
    }
    // D29: refuse to stage an equip on a busy (exploring / in-dungeon) character — the reason is human, immediate.
    if (equip_lock) {
      use_toast.getState().add(equip_lock, 'info')
      return
    }
    const equip_result = equip_preflight({
      item,
      character_level: level,
      character_class: character.classe ?? character.class_id,
      equipment,
      template_id_map,
      template_map,
    })
    if (!equip_result.allowed) {
      use_toast.getState().add(t(equip_result.reason), 'info')
      return
    }
    dispatch_stage(equip_stage_action(item, undefined, slugs, template_id_map))
  }

  const on_accept = async () => {
    if (committing) return
    if (equip_lock) {
      use_toast.getState().add(equip_lock, 'info')
      return
    }
    set_committing(true)
    // #317 — pending feedback fires ON CLICK, never behind a network leg: this persistent toast IS the
    // pending state from the instant Accept lands (the dominant cost was get_owner_items stalling silently
    // behind rpc/client.ts's 429 backoff — up to ~30s of retry_delay_ms with zero UI feedback). Every exit
    // below resolves or removes it; the tx-composition promise() further down swaps it in seamlessly (same
    // pending copy, so the handoff from this toast to that one is invisible).
    const pending_id = use_toast.getState().add_persistent(t('inventory.tx_equip_pending'), 'pending')
    let current_items
    try {
      current_items = address ? await get_owner_items(address) : null
    } catch (error) {
      game_log('inventory', 'equip preflight owner-items read failed', error)
      current_items = null
    }
    if (!current_items) {
      use_toast.getState().remove(pending_id)
      use_toast.getState().add(t('errors.tx_refused_preflight'), 'error')
      set_committing(false)
      return
    }
    const invalid_change = invalid_equip_change(equipment, real_equipment, current_items)
    if (invalid_change) {
      use_toast.getState().remove(pending_id)
      const key = invalid_change.reason === 'listed' ? 'errors.item_listed_for_sale' : 'errors.item_state_mismatch'
      use_toast.getState().add(t(key), 'info')
      dispatch_stage({ type: 'reset', equipment: real_equipment })
      set_committing(false)
      return
    }
    const { to_equip, to_unequip, equipped_full, unequipped_full } = equipment_change_set(
      equipment,
      real_equipment,
      current_items
    )
    if (!to_equip.length && !to_unequip.length) {
      use_toast.getState().remove(pending_id)
      set_committing(false)
      return
    }
    // #88 — legacy pet power can exceed the upgraded 60-feed stat curve. Read the item-side field directly
    // BEFORE bag optimism and BEFORE equip_items can compose a PTB; owner-items' event projection cannot prove
    // this because pre-upgrade feeds emitted no absolute feed-count event. Fail-open reads leave simulation as
    // the judge, while a proven >60 counter refuses honestly until the contract migration lands.
    const legacy_pet = await legacy_pet_equip_guard(to_equip)
    if (legacy_pet) {
      use_toast.getState().remove(pending_id)
      use_toast.getState().add(t('errors.pet_growth_migration_required'), 'info')
      dispatch_stage({ type: 'reset', equipment: real_equipment })
      set_committing(false)
      return
    }
    remove_bag_items(equipped_full.map((i) => i.id))
    add_bag_items(unequipped_full)
    const expected_change = {
      equipped_ids: to_equip.map((row) => row.item_id),
      unequipped_ids: to_unequip.map((row) => row.item_id),
    }
    use_toast.getState().remove(pending_id)
    let res
    try {
      res = await use_toast.getState().promise(equip_items({ character_id: character.id, to_equip, to_unequip }), {
        pending: t('inventory.tx_equip_pending'),
        success: t('inventory.tx_equip_success'),
      })
    } catch (error) {
      game_log('inventory', 'equip failed', error)
      add_bag_items(equipped_full)
      remove_bag_items(unequipped_full.map((i) => i.id))
      dispatch_stage({ type: 'reset', equipment: real_equipment })
      if (block_equip_retry(character.id, error) || block_equip_state_refresh(character.id, error)) {
        refresh_retry_guard((version) => version + 1)
        void refresh_equip_state()
      }
      set_committing(false)
      return
    }

    mark_ui_updated(res?.timing)
    // WORN RECEIPT (cape swap succeeded, but the world rig kept the old cape) — the signed tx PROVES
    // the cosmetic-slot transition, so project it onto the character row NOW: the rig re-dresses this frame
    // instead of waiting on (or losing to) the /v1 reconcile below, which adopts chain truth once confirmed.
    const worn_set = /** @type {Record<string, any>} */ ({})
    const worn_clear = /** @type {string[]} */ ([])
    for (const { item_id, slot, item_template_id } of to_equip)
      if (WORN_CATEGORIES.includes(slot)) worn_set[slot] = { item_id, template_id: item_template_id, category: slot }
    for (const { slot } of to_unequip) if (WORN_CATEGORIES.includes(slot) && !worn_set[slot]) worn_clear.push(slot)
    apply_worn_receipt(character.id, { set: worn_set, clear: worn_clear })
    // A changed object reference is not confirmation. Hide Accept but keep the optimistic stage authoritative
    // until fresh /v1 character + bag rows jointly prove the submitted item transition.
    dispatch_stage({ type: 'commit' })
    // #590 — the panel stays LOCKED (committing) across the reconcile and unlocks in the `finally` on EITHER
    // outcome. reconcile_equip_state throws on ordinary /v1 indexer lag; clearing the lock only on success
    // stranded `stage.committed` as a permanent "Updating equipment…" lock — every later unequip then hit the
    // equip_lock guard (a silent info toast, no tx, no digest). The optimistic stage stays authoritative for
    // DISPLAY (stage.committed) until a fresh /v1 read proves the transition; the load_roster poll is the
    // standing safety net when this reconcile cannot confirm in time. The panel remounts per character
    // (CharactersDrawer keys the tab body by id), so a lingering committed display never leaks across chars.
    try {
      await reconcile_equip_state(
        { address, character_id: character.id, expected_change },
        { is_current: () => use_auth.getState().address === address }
      )
      dispatch_stage({ type: 'reset', equipment })
    } catch (error) {
      game_log('inventory', 'equip succeeded but projection reconcile is still pending', error)
      remove_bag_items(equipped_full.map((item) => item.id))
      add_bag_items(unequipped_full)
    } finally {
      set_committing(false)
    }
  }

  const on_cancel = () => {
    dismiss_item_tooltip()
    dispatch_stage({ type: 'reset', equipment: real_equipment })
  }

  const slot_props = (/** @type {string} */ slot) => ({
    slot,
    item: equipment[slot],
    selected: !!equipment[slot] && equipment[slot].id === selected_item_id,
    valid: is_slot_valid(slot, dragging_item),
    slug_by_name: slugs,
    on_select: () => {
      dismiss_item_tooltip()
      if (equipment[slot]) set_selected_item_id(equipment[slot].id)
    },
    on_unequip: () => {
      dismiss_item_tooltip()
      if (equip_lock) return use_toast.getState().add(equip_lock, 'info') // D29: no unequip on a busy char
      dispatch_stage({ type: 'unequip', slot })
    },
    on_drag_start: () => {
      dismiss_item_tooltip()
      set_dragging_item(equipment[slot])
    },
    on_drag_end: () => set_dragging_item(null),
    on_drop: (/** @type {any} */ e) => {
      e.preventDefault()
      dismiss_item_tooltip()
      set_dragging_item(null)
      if (equip_lock) return use_toast.getState().add(equip_lock, 'info') // D29: no drop-to-equip on a busy char
      const item = dragging(e)
      if (is_item_listed(item)) return use_toast.getState().add(t('errors.item_listed_for_sale'), 'info')
      if (item) {
        const equip_result = equip_preflight({
          item,
          slot,
          character_level: level,
          character_class: character.classe ?? character.class_id,
          equipment,
          template_id_map,
          template_map,
        })
        if (!equip_result.allowed) return use_toast.getState().add(t(equip_result.reason), 'info')
        dispatch_stage(equip_stage_action(item, slot, slugs, template_id_map))
      }
    },
    on_hover_enter: on_item_hover,
    on_hover_move: on_item_hover_move,
    on_hover_leave: dismiss_item_tooltip,
    on_context_menu: (/** @type {any} */ e) => {
      // preventDefault unconditionally — this handler only ever fires from the FILLED slot art (EquipmentSlot
      // gates it), so the native menu must never show, guard or no guard.
      e.preventDefault()
      if (!equipment[slot]) return
      dismiss_item_tooltip()
      // character_id rides along so the menu's explorer row can link the CHARACTER page — an equipped item
      // is wrapped into it, so its own object id no longer resolves on chain (#1226).
      set_equip_menu({ x: e.clientX, y: e.clientY, item: equipment[slot], character_id: character?.id })
    },
  })

  return (
    <div className="inv">
      {/* LEFT gear column — character chip, the framed equipment paper-doll, equipped totals. Item
          detail lives in the shared hover tooltip now (freed space below the totals strip). */}
      <div className="inv__side">
        <div className="inv__chip">
          <CharacterPortrait
            sprites={class_sprite_base(character.classe ?? character.class_id) ?? PLACEHOLDER_SPRITES}
            hue={hue}
            size={44}
            className="inv__chip-port"
          />
          <div className="inv__chip-id">
            <span className="inv__chip-name">{character.name}</span>
            <span className="inv__chip-class">
              {class_title(t, character.classe ?? character.class_id) ?? t('stats.adventurer')}
            </span>
          </div>
          <span className="inv__chip-lvl hud-num">Lv {level}</span>
        </div>

        <div className="inv__eyebrow">
          <b>Equipment</b>
        </div>
        {equip_lock && lock?.inline && (
          <EquipmentLockNotice
            copy={equip_lock}
            refresh_label={t('inventory.refresh_equipment_state')}
            on_refresh={equip_retry_blocked || equip_state_stale ? refresh_equip_state : null}
          />
        )}
        <EquipmentDoll
          slot_props={slot_props}
          footer={
            stage.dirty ? (
              <div className="inv__doll-edit">
                <button type="button" className="hud-btn" disabled={committing} onClick={on_cancel}>
                  Cancel
                </button>
                <button type="button" className="hud-btn hud-btn--accent" disabled={committing} onClick={on_accept}>
                  {committing ? '…' : 'Accept'}
                </button>
              </div>
            ) : null
          }
        />

        {/* COSMETICS — the three real Move slots, all wired through the same staging/equip path as gear. */}
        <div className="inv__eyebrow">
          <b>{t('inventory.cosmetics')}</b>
        </div>
        <CosmeticSlots slot_props={slot_props} />

        <div className="inv__eyebrow">Equipped totals</div>
        <div className="inv__totals">
          {totals === null ? (
            <span className="inv__totals-empty">{t('stats.unavailable')}</span>
          ) : totals.length === 0 ? (
            <span className="inv__totals-empty">No gear equipped</span>
          ) : (
            totals.map(({ key, label, value }) => (
              <span className="inv__total" key={key}>
                <span className="inv__total-v hud-num">{value}</span>
                <span className="inv__total-k">{label}</span>
              </span>
            ))
          )}
        </div>
      </div>

      <InventoryBag
        category={category}
        set_category={set_category}
        tabs={TABS}
        counts={counts}
        total_count={total_count}
        grid_items={grid_items}
        empty_count={empty_count}
        selected_item_id={selected_item_id}
        equip_lock={equip_lock}
        is_removed={(item) => is_template_removed(item, template_map)}
        is_retry_blocked={(item) => is_lootbox(item.item_type) && is_box_retry_blocked(item.id)}
        equip_refusal={(item) =>
          equip_preflight({
            item,
            character_level: level,
            character_class: character.classe ?? character.class_id,
            equipment,
            template_id_map,
            template_map,
          }).reason
        }
        on_select={set_selected_item_id}
        on_activate={on_grid_activate}
        on_context_menu={on_grid_context_menu}
        on_drag_start={set_dragging_item}
        on_drag_end={() => set_dragging_item(null)}
        on_hover_enter={(event, item) => {
          set_hovered_bag_id(item.id)
          on_item_hover(event, item)
        }}
        on_hover_move={on_item_hover_move}
        on_hover_leave={dismiss_item_tooltip}
        on_dismiss_tooltip={dismiss_item_tooltip}
      />
      <InventoryOverlays
        pet_menu={pet_menu}
        set_pet_menu={set_pet_menu}
        feed_modal={feed_modal}
        set_feed_modal={set_feed_modal}
        food_slugs={food_slugs}
        pet_max_stats={pet_max_stats_by_template_id[feed_modal?.pet?.template_id ?? feed_modal?.pet?.template]}
        owned={owned}
        character={character}
        crush_menu={crush_menu}
        set_crush_menu={set_crush_menu}
        crush_confirm={crush_confirm}
        set_crush_confirm={set_crush_confirm}
        box_menu={box_menu}
        set_box_menu={set_box_menu}
        equip_menu={equip_menu}
        set_equip_menu={set_equip_menu}
        reveal_box={reveal_box}
        set_reveal_box={set_reveal_box}
        on_box_retry_blocked={on_box_retry_blocked}
        on_box_retry_allowed={on_box_retry_allowed}
        tooltip_element={tooltip_element}
      />
    </div>
  )
}
