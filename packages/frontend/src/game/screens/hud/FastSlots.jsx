// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Fast-slots — a small bottom bar of consumable quick-slots. Drag a consumable from the inventory grid
// into a slot; left-click (or the right-click menu's "Use") consumes it. #31/D307: uses go through the
// BATCHED chain-direct consume (world-shell/consumable_actions.js) — each click paints one unit off the
// stack instantly and rapid clicks fold into ONE tx carrying the accumulated amount (the on-chain entry
// spends the stack PER-UNIT since D58b). Right-click context-menu pattern ported from koshi-2d ContextMenu.tsx.
//
// PREFERENCE, not gameplay: localStorage = preferences only, game data from chain — the
// slot→item-id assignment is a per-session UI preference kept in component state. FLAG: persisting it
// (as a preference) is a follow-up; the consumable stacks themselves are on-chain truth.

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ITEM_CATEGORY } from '@aresrpg/sdk/items'

import { use_game_state } from '../../store.js'
import { use_consumable_batched } from '../../../world-shell/consumable_actions.js'
import { use_toast } from '../../../toast'
import { ItemSendModal } from '../../../components/item_send_modal'
import { project_inventory_send_item } from '../../../stores/item_send_model'
import { can_consume } from './inventory-equip.js'
import { project_inventory_context_actions } from './inventory_context_actions'
import { ItemIcon } from './ItemIcon.jsx'
import { Tooltip } from './Tooltip.jsx'
import './fast-slots.css'

const SLOT_COUNT = 6

const is_consumable = (/** @type {any} */ item) => item?.item_category === ITEM_CATEGORY.CONSUMABLE

/**
 * Fast-slots bar. Reads the wallet's consumable items + the selected character from engine state;
 * the slot assignments are session-local.
 * @returns {import('react').JSX.Element | null}
 */
export function FastSlots() {
  const { t } = useTranslation()
  const items = use_game_state((s) => s.sui.items)
  const characters = use_game_state((s) => s.sui.characters)
  const selected_character_id = use_game_state((s) => s.selected_character_id)

  // slot index -> item id (the assignment); item DATA is always resolved live from the store.
  const [assigned, set_assigned] = useState(/** @type {(string | null)[]} */ (Array(SLOT_COUNT).fill(null)))
  // open context menu: { slot, x, y } or null
  const [menu, set_menu] = useState(/** @type {{ slot: number, x: number, y: number } | null} */ (null))
  const [send_items, set_send_items] = useState(null)

  const character = useMemo(
    () => characters?.find((c) => c.id === selected_character_id) ?? null,
    [characters, selected_character_id]
  )

  const owned = Array.isArray(items) ? items : []
  const menu_actions = project_inventory_context_actions(['use', 'clear'])

  // Resolve each slot's live item record (null if the stack is gone / unassigned).
  const slot_item = (/** @type {number} */ slot) => {
    const id = assigned[slot]
    if (!id) return null
    return owned.find((it) => it.id === id && is_consumable(it)) ?? null
  }

  // Close the menu on any outside click / escape.
  useEffect(() => {
    if (!menu) return undefined
    const close = () => set_menu(null)
    const on_key = (/** @type {KeyboardEvent} */ e) => {
      if (e.key === 'Escape') set_menu(null)
    }
    window.addEventListener('click', close)
    window.addEventListener('keydown', on_key)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', on_key)
    }
  }, [menu])

  if (!character) return null

  // #31/D307 — consume ONE unit of the potion in `slot` per click: the ×N badge drops instantly (the slot
  // empties on the last unit) and rapid clicks fold into ONE trailing batched tx. Toasts / failure rollback /
  // chain reconcile live in the batch home (consumable_actions.js) — one toast per batch, never per click.
  const use_slot = (/** @type {number} */ slot) => {
    const item = slot_item(slot)
    if (!item) return
    set_menu(null)
    // PRE-CHECK: full-HP → the use can only abort on-chain — refuse before any tx.
    if (!can_consume(character)) {
      use_toast.getState().add(t('inventory.already_full_hp'), 'info')
      return
    }
    use_consumable_batched({ character_id: character.id, potion_id: item.id, item_type: item.item_type })
  }

  const drop_on_slot = (/** @type {number} */ slot, /** @type {DragEvent | any} */ e) => {
    e.preventDefault()
    const id = e.dataTransfer.getData('text/plain')
    const item = owned.find((it) => it.id === id)
    if (!is_consumable(item)) return // only consumables go in fast-slots
    set_assigned((prev) => prev.map((cur, i) => (i === slot ? id : cur)))
  }

  return (
    <div className="fastslots" role="toolbar" aria-label="Consumable fast slots">
      {Array.from({ length: SLOT_COUNT }, (_, slot) => {
        const item = slot_item(slot)
        return (
          <Tooltip
            key={slot}
            text={item ? `${item.name}: left-click to use, right-click to clear` : 'Drag a consumable here'}
          >
            <div
              className={`fastslots__slot${item ? ' is-filled' : ''}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => drop_on_slot(slot, e)}
              onContextMenu={(e) => {
                e.preventDefault()
                if (item) set_menu({ slot, x: e.clientX, y: e.clientY })
              }}
              onClick={() => item && use_slot(slot)}
            >
              {item ? (
                <>
                  <ItemIcon item={{ icon: item.icon ?? item.item_type }} alt={item.name} className="fastslots__img" />
                  {(item.amount ?? 1) > 1 && <span className="fastslots__amount hud-num">{item.amount}</span>}
                </>
              ) : (
                <span className="fastslots__key hud-num">{slot + 1}</span>
              )}
            </div>
          </Tooltip>
        )
      })}

      {menu &&
        (() => {
          const item = slot_item(menu.slot)
          if (!item) return null
          return (
            <div
              className="fastslots__menu"
              style={{ left: menu.x, top: menu.y }}
              onClick={(e) => e.stopPropagation()}
              role="menu"
            >
              <div className="fastslots__menu-head">{item.name}</div>
              {menu_actions.includes('use') && (
                <button type="button" className="fastslots__menu-item" onClick={() => use_slot(menu.slot)}>
                  Use
                </button>
              )}
              {menu_actions.includes('clear') && (
                <button
                  type="button"
                  className="fastslots__menu-item fastslots__menu-item--muted"
                  onClick={() => {
                    set_assigned((prev) => prev.map((cur, i) => (i === menu.slot ? null : cur)))
                    set_menu(null)
                  }}
                >
                  Clear slot
                </button>
              )}
              {menu_actions.includes('send') && (
                <button
                  type="button"
                  className="fastslots__menu-item fastslots__menu-item--accent"
                  onClick={() => {
                    set_send_items([project_inventory_send_item(item, owned)])
                    set_menu(null)
                  }}
                >
                  {t('gift.send.send_items')}
                </button>
              )}
            </div>
          )
        })()}
      {send_items && <ItemSendModal items={send_items} on_close={() => set_send_items(null)} />}
    </div>
  )
}
