// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

// EQUIPMENT — the loadout surface: the paper-doll + equipped totals on the left, the bag on
// the right (category tabs, grid, drag-drop). Changes STAGE locally; Accept composes ONE
// SDK transaction and the proven receipt folds through the session reducer (the server
// never re-sends what this player's own transaction caused). Click a bag item to inspect
// it, double-click to equip (or drink), drag it onto a slot to aim a specific slot, click
// a filled slot to inspect it, double-click to stage its unequip.

import { IconButton } from '@aresrpg/ui'
import { character_equipment_slots } from '@aresrpg/immutable'
import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import type { CharacterRow } from '@aresrpg/protocol'

import { item_icon } from '../content/assets.ts'
import { CharacterPreviewCanvas } from '../components/CharacterPreviewCanvas.tsx'
import { character_render_source } from '../game/character_entities.ts'
import { EquipmentDoll } from '../components/EquipmentDoll.tsx'
import { OwnedItemDetail } from '../components/OwnedItemDetail.tsx'
import { titleize } from '../content/catalog.ts'
import { copy_text, stat_name, type AppCopy } from '../i18n/copy.ts'

import { equipment_comparison } from './equipment_comparison.ts'
import { useEquipment } from './useEquipment.ts'
import type { CharacterSession } from './character_session.ts'
import { ConsumeHealingModal } from './ConsumeHealingModal.tsx'
import { equip_refusal, stage_unequip } from './equipment_stage.ts'
import { InventorySelectionGrid } from './InventorySelectionGrid.tsx'
import { InventoryItemCell } from './InventoryItemCell.tsx'
import { inventory_action_selection, useInventoryActions } from './InventoryOverlays.tsx'
import { InventoryItemActions } from './InventoryItemActions.tsx'
import { select_inventory_item } from './inventory_selection.ts'
import { BAG_CATEGORIES, InventoryResourceFilters } from './InventoryResourceFilters.tsx'
import { PendingClaims } from './PendingClaims.tsx'

export default function EquipmentTab({
  character,
  copy,
  session,
}: Readonly<{ character: Readonly<CharacterRow>; copy: AppCopy; session?: CharacterSession }>) {
  const {
    t,
    encumbered_ids,
    inventory,
    staged,
    set_staged,
    category,
    set_category,
    resource_filter,
    set_resource_filter,
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
  } = useEquipment({ character, copy, session })

  const [query, set_query] = useState('')
  const filtered = grid_items.filter(({ item }) => item.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const category_art = { equipment: 'theban_scrapblade', consumables: 'recall_potion', resources: 'wheat_barley' }

  const preview_source = useMemo(
    () =>
      character_render_source({
        ...character,
        equipment: Object.values(equipment).flatMap((item) => (item ? [item] : [])),
      }),
    [character, equipment]
  )

  const inspected_slot = character_equipment_slots.find((slot) => equipment[slot]?.id === inspected?.id)
  const inspected_bag_item = bag.find((item) => item.id === inspected?.id)

  const item_actions = useInventoryActions({
    copy,
    menu,
    close_menu: () => set_menu(null),
    reveal_box,
    set_reveal_box,
    inventory_override: session?.inventory,
    detail: inventory_action_selection(inspected_bag_item, selected_items),
  })
  return (
    <div
      className="chr-equip"
      onClick={(event) => {
        if (committing) return
        const target = event.target as Element
        if (
          !target.closest(
            'button, input, select, textarea, a, label, [role="button"], .aui-selection-grid, .chr-equip__detail'
          )
        )
          set_selected_ids([])
      }}
    >
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
          preview={<CharacterPreviewCanvas source={preview_source} pedestal />}
          item_for={(slot) => equipment[slot] ?? null}
          open={(slot) => {
            if (committing) return
            const worn = equipment[slot]
            if (!worn) return
            set_inspected_id(worn.id)
            set_selected_ids([])
          }}
          slot_state={(slot) => {
            const dragged = dragging_id ? bag.find(({ id }) => id === dragging_id) : null
            const valid =
              !!dragged &&
              !equip_refusal({
                item: dragged,
                slot,
                character_level: character.level,
                equipment,
                listed_ids: encumbered_ids,
              })
            return {
              valid,
              staged: changes.to_equip.some((change) => change.slot === slot),
              on_double_click: () => {
                if (committing || !equipment[slot]) return
                set_staged(stage_unequip(equipment, slot))
              },
              on_drop: (event) => {
                event.preventDefault()
                const item = bag.find(({ id }) => id === event.dataTransfer.getData('text/plain'))
                set_dragging_id(null)
                if (item) try_stage(item, slot)
              },
            }
          }}
          footer={
            <div className="inventory-commit-bar" style={{ visibility: dirty ? 'visible' : 'hidden' }}>
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

        {inspected && (
          <div className="chr-equip__detail" data-item-category={inspected.category}>
            <IconButton
              className="inventory-item-close"
              label={copy.wallet_close}
              icon={<span aria-hidden="true">×</span>}
              onClick={() => set_inspected_id(null)}
            />
            <OwnedItemDetail
              item={inspected}
              copy={copy}
              craft_session={{ character, inventory: session?.inventory }}
              comparison={equipment_comparison(inspected, equipment)}
            />
            <InventoryItemActions
              item={inspected}
              equipped={!!inspected_slot}
              selected={selected_ids.includes(inspected.id)}
              disabled={committing}
              can_use={!session}
              entries={item_actions.detail_entries}
              copy={copy}
              toggle={() => {
                set_selected_ids(select_inventory_item(selected_ids, inspected.id, true))
                set_inspected_id(null)
              }}
              close={() => set_inspected_id(null)}
              activate={() => {
                if (inspected_slot) set_staged(stage_unequip(equipment, inspected_slot))
                else if (inspected_bag_item) activate(inspected_bag_item)
                set_inspected_id(null)
              }}
            />
          </div>
        )}
      </div>

      <div className="chr-equip__bag" data-tutorial-target="shared_inventory">
        <PendingClaims copy={copy} />
        <div className="chr-equip__bagtabs">
          {BAG_CATEGORIES.map((key) => (
            <button
              className={`chr-bagtab ${category === key ? 'is-active' : ''}`}
              aria-label={t(`bag_${key}`)}
              aria-pressed={category === key}
              title={t(`bag_${key}`)}
              key={key}
              onClick={() => {
                set_category(key)
                set_selected_ids([])
              }}
              type="button"
            >
              <img src={item_icon(category_art[key]) ?? undefined} alt="" />
              <span className="inventory-category-name">{t(`bag_${key}`)}</span>
              <span className="inventory-category-count">{counts[key]}</span>
            </button>
          ))}
        </div>
        <label className="inventory-search">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            aria-label={copy.ui.inventory_search}
            placeholder={copy.ui.inventory_search}
            value={query}
            onChange={(event) => {
              set_query(event.target.value)
            }}
          />
        </label>
        <InventoryResourceFilters
          category={category}
          filter={resource_filter}
          select={set_resource_filter}
          items={display_bag}
          copy={copy}
        />
        <InventorySelectionGrid
          class_name="chr-equip__grid"
          copy={copy}
          items={grid_items.map(({ item }) => item)}
          selected={selected_ids}
          change={set_selected_ids}
          menu={set_menu}
          disabled={committing}
          drag_item={set_dragging_id}
          equip={try_stage}
        >
          {filtered.map(({ item, amount }) => (
            <InventoryItemCell
              amount={amount}
              class_name={selected_ids.includes(item.id) ? 'is-selected' : ''}
              aria-pressed={selected_ids.includes(item.id)}
              item={item}
              key={item.id}
              onClick={(event) => select_item(item, event.shiftKey)}
              onDoubleClick={(event) => {
                if (!event.shiftKey) activate(item)
              }}
              onContextMenu={(event) => {
                event.preventDefault()
                if (!selected_ids.includes(item.id)) select_item(item, false)
                set_menu({ x: event.clientX, y: event.clientY, ...inventory_action_selection(item, selected_items)! })
              }}
              show_level
            />
          ))}
          {Array.from({ length: empty_cells }, (_, index) => (
            <span aria-hidden="true" className="chr-cell chr-cell--empty" key={`empty-${index}`} />
          ))}
        </InventorySelectionGrid>
      </div>
      <ConsumeHealingModal
        character={character}
        close={() => set_healing_item(null)}
        confirm={drink}
        copy={copy}
        item={healing_item}
      />
      {item_actions.overlays}
    </div>
  )
}
