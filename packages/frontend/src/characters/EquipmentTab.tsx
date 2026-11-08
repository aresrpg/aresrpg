// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

// One equipment gesture submits immediately; the pending preview restores on failure.
// Shift-click and Shift-drag select. Double-click equips; touch retains the Equip action.

import { IconButton } from '@aresrpg/ui'
import { character_equipment_slots } from '@aresrpg/immutable'
import { cloneElement, useId, useMemo, useState } from 'react'
import type { CharacterRow } from '@aresrpg/protocol'

import { CharacterPreviewCanvas } from '../components/CharacterPreviewCanvas.tsx'
import { character_render_source } from '../game/character_entities.ts'
import { ItemDetailHover } from '../components/ItemSnapshotTooltip.tsx'
import { EquipmentDoll } from '../components/EquipmentDoll.tsx'
import { OwnedItemDetail } from '../components/OwnedItemDetail.tsx'
import { titleize } from '../content/catalog.ts'
import { stat_name, type AppCopy } from '../i18n/copy.ts'
import { AgentKioskPanel } from '../agents/AgentKioskPanel.tsx'
import { useAgentKiosk } from '../agents/useAgentKiosk.ts'

import { equipment_comparison } from './equipment_comparison.ts'
import { useEquipment } from './useEquipment.ts'
import type { CharacterSession } from './character_session.ts'
import { ConsumeHealingModal } from './ConsumeHealingModal.tsx'
import { equip_refusal } from './equipment_stage.ts'
import { InventorySelectionGrid } from './InventorySelectionGrid.tsx'
import { InventoryItemCell } from './InventoryItemCell.tsx'
import { inventory_action_selection, useInventoryActions } from './InventoryOverlays.tsx'
import { InventoryItemActions } from './InventoryItemActions.tsx'
import { select_inventory_item } from './inventory_selection.ts'
import { InventoryFilters } from './InventoryFilters.tsx'
import { PendingClaims } from './PendingClaims.tsx'

export default function EquipmentTab({
  character,
  copy,
  session,
}: Readonly<{ character: Readonly<CharacterRow>; copy: AppCopy; session?: CharacterSession }>) {
  const kiosk = useAgentKiosk(copy, !!session)
  const {
    t,
    encumbered_ids,
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
  } = useEquipment({ character, copy, session, blocked_inventory: kiosk.pending_deposit_ids })

  const [query, set_query] = useState('')
  const [equipment_open, set_equipment_open] = useState(false)
  const equipment_id = useId()
  const filtered = grid_items.filter(({ item }) => item.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))

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
      className="chr-equip chr-equip--agent"
      data-equipment-open={equipment_open || undefined}
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
      <button
        type="button"
        className="agent-equipment-toggle"
        aria-controls={equipment_id}
        aria-expanded={equipment_open}
        onClick={() => set_equipment_open(!equipment_open)}
      >
        {t('equipment_head')}
      </button>
      <div id={equipment_id} className="chr-equip__side" data-tutorial-target="character_equipment">
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

        <p
          className="border-l-2 border-gold/60 p-3 text-xs leading-relaxed text-text empty:hidden"
          data-equipment-quest=""
        >
          {session?.equipment_notice}
        </p>
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
            const worn = equipment[slot]
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
              hover: worn
                ? (content) => (
                    <ItemDetailHover item={worn}>{cloneElement(content, { title: undefined })}</ItemDetailHover>
                  )
                : undefined,
              valid,
              pending: [...changes.to_equip, ...changes.to_unequip].some((change) => change.slot === slot),
              on_double_click: () => {
                if (committing || !equipment[slot]) return
                unequip(slot)
              },
            }
          }}
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
                if (inspected_slot) unequip(inspected_slot)
                else if (inspected_bag_item) activate(inspected_bag_item)
                set_inspected_id(null)
              }}
            />
          </div>
        )}
      </div>

      <div className="chr-equip__bag" data-tutorial-target="shared_inventory" data-inventory-owner="player">
        <PendingClaims copy={copy} />
        <InventoryFilters
          category={category}
          set_category={(value) => {
            set_category(value)
            set_selected_ids([])
          }}
          resource_filter={resource_filter}
          set_resource_filter={set_resource_filter}
          query={query}
          set_query={set_query}
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
          disabled={[committing, kiosk.busy].some(Boolean)}
          drag_item={set_dragging_id}
          equip={equip}
          transfer={(ids, point) => {
            if (!document.elementFromPoint(point.x, point.y)?.closest('[data-inventory-owner="agent"]')) return false
            if (!committing) kiosk.offer(ids, 'deposit', bag)
            return true
          }}
        >
          {filtered.map(({ item, amount, items }) => (
            <InventoryItemCell
              amount={amount}
              class_name={selected_ids.includes(item.id) ? 'is-selected' : ''}
              aria-pressed={selected_ids.includes(item.id)}
              item={item}
              key={item.id}
              disabled={[committing, kiosk.busy].some(Boolean)}
              pending={items.some(({ id }) => kiosk.pending_ids.has(id))}
              onClick={(event) => select_item(item, event.shiftKey)}
              onDoubleClick={(event) => {
                if (!event.shiftKey) activate(item)
              }}
              onContextMenu={(event) => {
                event.preventDefault()
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
      <AgentKioskPanel
        key={kiosk.pairing?.address}
        kiosk={kiosk}
        copy={copy}
        disabled={committing}
        offline={!!session}
      />
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
