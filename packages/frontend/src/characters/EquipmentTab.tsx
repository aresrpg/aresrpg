// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// EQUIPMENT — the loadout surface: the paper-doll + equipped totals on the left, the bag on
// the right (category tabs, grid, drag-drop). Changes STAGE locally; Accept composes ONE
// SDK transaction and the proven receipt folds through the session reducer (the server
// never re-sends what this player's own transaction caused). Click a bag item to inspect
// it, double-click to equip (or drink), drag it onto a slot to aim a specific slot, click
// a filled slot to stage its unequip.

import { useMemo, useState } from 'react'
import type { CharacterEquipmentSlot } from '@aresrpg/immutable'
import { item_stat_center, stat_names } from '@aresrpg/immutable'
import type { CharacterRow, ItemRow } from '@aresrpg/protocol'

import { EquipmentDoll } from '../components/EquipmentDoll.tsx'
import { ItemDetailView } from '../components/ItemDetailView.tsx'
import { encyclopedia_catalog, titleize } from '../content/catalog.ts'
import { encyclopedia_text } from '../encyclopedia/copy.ts'
import { character_max_hp, fold_equipment_stats, projected_hp } from '../game/character_stats.ts'
import { copy_text, stat_name, type AppCopy } from '../i18n/copy.ts'
import { encumbered_asset_ids } from '../inventory_stacks.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { toast } from '../toast.ts'
import { run_direct_transaction } from '../transaction_guard.ts'

import {
  equip_refusal,
  equipment_change_set,
  equipment_map_of,
  natural_slot_for,
  stage_equip,
  stage_unequip,
  type EquipmentMap,
} from './equipment_stage.ts'
import { InventoryActionOverlays, is_loot_box, type ItemMenuState } from './InventoryOverlays.tsx'
import { InventoryItemCell } from './InventoryItemCell.tsx'

const BAG_CATEGORIES = ['equipment', 'consumables', 'resources'] as const
type BagCategory = (typeof BAG_CATEGORIES)[number]

const bag_category_of = (item: Readonly<ItemRow>): BagCategory => {
  if (item.category === 'consumable') return 'consumables'
  if (item.category === 'resource' || item.category === 'rune' || item.category === 'key') return 'resources'
  return 'equipment'
}

const consumable_action = (item: Readonly<ItemRow>, character: Readonly<CharacterRow>) => {
  const effect = encyclopedia_catalog.item(item.item_type)?.item.consumable
  if (!effect || effect.type === 'loot_box') return null
  return Object.freeze({
    effect,
    already_full: effect.type === 'heal' && projected_hp(character, Date.now()) >= character_max_hp(character),
    heal: effect.type === 'heal' ? effect.amount : 0,
  })
}

const MIN_GRID_CELLS = 40

export default function EquipmentTab({
  character,
  copy,
}: Readonly<{ character: Readonly<CharacterRow>; copy: AppCopy }>) {
  const t = copy_text(copy.characters_page)
  const encyclopedia = encyclopedia_text(copy)
  const wallet = useAppStore(({ session }) => session.wallet)
  const all_inventory = useAppStore(({ session }) => session.inventory)
  const listings = useAppStore(({ marketplace }) => marketplace.own_listings)
  const trades = useAppStore(({ trade }) => trade.rows)
  const inventory = useMemo(
    () => all_inventory.filter(({ kiosk }) => kiosk === character.kiosk),
    [all_inventory, character.kiosk]
  )
  const real = useMemo(() => equipment_map_of(character), [character])
  const [staged, set_staged] = useState<EquipmentMap | null>(null)
  const [category, set_category] = useState<BagCategory>('equipment')
  const [selected_id, set_selected_id] = useState<string | null>(null)
  const [dragging_id, set_dragging_id] = useState<string | null>(null)
  const [committing, set_committing] = useState(false)
  const [menu, set_menu] = useState<ItemMenuState>(null)
  const [reveal_box, set_reveal_box] = useState<ItemRow | null>(null)

  const equipment = staged ?? real
  const changes = useMemo(() => equipment_change_set(equipment, real), [equipment, real])
  const dirty = changes.to_equip.length > 0 || changes.to_unequip.length > 0
  const listed_ids = useMemo(() => encumbered_asset_ids(listings, trades), [listings, trades])
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
  const counts = useMemo(
    () =>
      bag.reduce((totals, item) => ({ ...totals, [bag_category_of(item)]: totals[bag_category_of(item)] + 1 }), {
        equipment: 0,
        consumables: 0,
        resources: 0,
      }),
    [bag]
  )
  const grid_items = useMemo(() => bag.filter((item) => bag_category_of(item) === category), [bag, category])

  const selected =
    bag.find(({ id }) => id === selected_id) ??
    Object.values(equipment).find((item) => item?.id === selected_id) ??
    null

  const refuse = (item: Readonly<ItemRow>, slot: CharacterEquipmentSlot): boolean => {
    const refusal = equip_refusal({ item, slot, character_level: character.level, equipment, listed_ids })
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

  const drink = (item: Readonly<ItemRow>): void => {
    const action = consumable_action(item, character)
    if (!action || !wallet) return
    if (action.already_full) return void toast.add(t('already_full_hp'), 'info')
    const transaction = run_direct_transaction(() =>
      wallet.character.use_consumable({
        character_id: character.id,
        item_id: item.id,
        item_type: item.item_type,
        custody: { kiosk: character.kiosk, kiosk_cap: character.kiosk_cap },
      })
    )
    if (!transaction) return
    set_committing(true)
    const pending = toast.loading(t('consume_pending'))
    void transaction
      .then(() => {
        dispatch_app({
          type: 'character/consumed',
          character_id: character.id,
          item_id: item.id,
          effect: action.effect.type,
          heal: action.heal,
        })
        pending.success(t('consume_success'))
      })
      .catch(pending.error)
      .finally(() => set_committing(false))
  }

  const activate = (item: Readonly<ItemRow>): void => {
    if (listed_ids.has(item.id)) return void toast.add(t('refusal_item_listed'), 'info')
    if (is_loot_box(item)) return set_reveal_box(item)
    const seed = encyclopedia_catalog.item(item.item_type)?.item
    if (seed?.consumable) return drink(item)
    try_stage(item, null)
  }

  const accept = (): void => {
    if (!dirty || committing || !wallet) return
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

  const detail = useMemo(() => {
    if (!selected) return null
    const seed = encyclopedia_catalog.item(selected.item_type)?.item ?? null
    const rolled = selected.stats
      ? Object.fromEntries(
          Object.entries(selected.stats)
            .map(([stat, value]) => [stat, value - item_stat_center])
            .filter(([, value]) => value !== 0)
        )
      : null
    return {
      name: selected.name,
      category: selected.category,
      level: selected.level,
      item_type: selected.item_type,
      stats: rolled ? { min: rolled, max: rolled } : seed?.stats,
      damages: (selected.damages ?? seed?.damages ?? []).map((line) => ({
        element: line.element,
        from: Number(line.from),
        to: Number(line.to),
        damage_type: 'damage_type' in line ? String(line.damage_type ?? 'damage') : 'damage',
      })),
    }
  }, [selected])

  const empty_cells = Math.max(0, MIN_GRID_CELLS - grid_items.length)

  return (
    <div className="chr-equip">
      {/* LEFT — identity chip, the paper-doll, equipped totals, the selected item's sheet */}
      <div className="chr-equip__side" data-tutorial-target="character_equipment">
        <div className="chr-equip__chip">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11px] font-semibold tracking-[0.14em] text-text uppercase">
              {character.name}
            </div>
            <div className="text-[8px] tracking-[0.2em] text-muted uppercase">{titleize(character.classe)}</div>
          </div>
          <span className="text-[10px] text-gold tabular-nums">
            {t('level').replaceAll('{{level}}', String(character.level))}
          </span>
        </div>

        <div className="chr-eyebrow">{t('equipment_head')}</div>
        <EquipmentDoll
          item_for={(slot) => equipment[slot] ?? null}
          open={(slot) => {
            if (committing) return
            const worn = equipment[slot]
            if (!worn) return
            set_selected_id(worn.id)
            set_staged(stage_unequip(equipment, slot))
          }}
          slot_state={(slot) => {
            const dragged = dragging_id ? bag.find(({ id }) => id === dragging_id) : null
            const valid =
              !!dragged &&
              !equip_refusal({ item: dragged, slot, character_level: character.level, equipment, listed_ids })
            return {
              valid,
              staged: changes.to_equip.some((change) => change.slot === slot),
              on_drop: (event) => {
                event.preventDefault()
                const item = bag.find(({ id }) => id === event.dataTransfer.getData('text/plain'))
                set_dragging_id(null)
                if (item) try_stage(item, slot)
              },
            }
          }}
          footer={
            dirty ? (
              <div className="flex gap-2">
                <button
                  className="btn-outline chr-btn"
                  disabled={committing}
                  onClick={() => set_staged(null)}
                  type="button"
                >
                  {t('cancel')}
                </button>
                <button className="btn-gold chr-btn" disabled={committing} onClick={accept} type="button">
                  {committing ? '…' : t('accept')}
                </button>
              </div>
            ) : null
          }
        />

        <div className="chr-eyebrow">{t('equipped_totals')}</div>
        <div className="chr-equip__totals">
          {totals.length === 0 ? (
            <span className="text-[9px] tracking-[0.12em] text-muted uppercase">{t('no_gear_equipped')}</span>
          ) : (
            totals.map(({ stat, value }) => (
              <span className="chr-equip__total" key={stat}>
                <b className={`tabular-nums ${value < 0 ? 'text-[#ff5f5f]' : 'text-gold'}`}>
                  {value > 0 ? `+${value}` : value}
                </b>
                <span>{stat_name(copy, stat)}</span>
              </span>
            ))
          )}
        </div>

        {detail && (
          <div className="chr-equip__detail">
            <ItemDetailView
              category={detail.category}
              damages={detail.damages}
              item_type={detail.item_type}
              labels={{
                characteristics: encyclopedia('characteristics'),
                damages: encyclopedia('damages'),
                level_short: encyclopedia('level_short', { level: detail.level }),
                range_to: encyclopedia('range_to'),
              }}
              level={detail.level}
              name={detail.name}
              stats={detail.stats}
            />
          </div>
        )}
      </div>

      {/* RIGHT — the bag: category tabs + grid */}
      <div className="chr-equip__bag" data-tutorial-target="shared_inventory">
        <div className="chr-equip__bagtabs">
          {BAG_CATEGORIES.map((key) => (
            <button
              className={`chr-bagtab ${category === key ? 'is-active' : ''}`}
              key={key}
              onClick={() => set_category(key)}
              type="button"
            >
              {t(`bag_${key}`)}
              <span className="tabular-nums opacity-60">{counts[key]}</span>
            </button>
          ))}
        </div>
        <div className="chr-equip__grid">
          {grid_items.map((item) => (
            <InventoryItemCell
              class_name={`${selected_id === item.id ? 'is-selected' : ''} ${listed_ids.has(item.id) ? 'is-listed' : ''}`.trim()}
              draggable
              item={item}
              key={item.id}
              onClick={() => set_selected_id(item.id)}
              onDoubleClick={() => activate(item)}
              onDragEnd={() => set_dragging_id(null)}
              onDragStart={(event) => {
                event.dataTransfer.setData('text/plain', item.id)
                set_dragging_id(item.id)
              }}
              onContextMenu={(event) => {
                event.preventDefault()
                set_selected_id(item.id)
                set_menu({ x: event.clientX, y: event.clientY, item })
              }}
              show_level
            />
          ))}
          {Array.from({ length: empty_cells }, (_, index) => (
            <span aria-hidden="true" className="chr-cell chr-cell--empty" key={`empty-${index}`} />
          ))}
        </div>
      </div>
      <InventoryActionOverlays
        close_menu={() => set_menu(null)}
        copy={copy}
        menu={menu}
        reveal_box={reveal_box}
        set_reveal_box={set_reveal_box}
      />
    </div>
  )
}
