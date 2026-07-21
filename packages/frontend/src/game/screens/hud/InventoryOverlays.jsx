// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Hammer } from 'lucide-react'

import { CrushMenu } from '../../../components/crush_menu'
import { ExplorerMenuRow } from '../../../components/explorer_link'
import { ItemSendMenuRow } from '../../../components/item_send_menu_row'
import { ItemSendModal } from '../../../components/item_send_modal'
import { pet_feed_foods } from '../../../components/pet_power_card.jsx'
import { project_inventory_send_item } from '../../../stores/item_send_model'

import { BoxReveal } from './BoxReveal.jsx'
import { EquipMenu } from './EquipMenu.jsx'
import { is_box_retry_blocked } from './lootbox-retry-guard.js'
import { PetFeedModal } from './PetFeedModal.jsx'
import { project_inventory_context_actions } from './inventory_context_actions'

/** Inventory context menus/modals kept outside the main drawer component so each touched file stays bounded. */
export function InventoryOverlays({
  pet_menu,
  set_pet_menu,
  feed_modal,
  set_feed_modal,
  food_slugs,
  pet_max_stats,
  owned,
  character,
  crush_menu,
  set_crush_menu,
  crush_confirm,
  set_crush_confirm,
  box_menu,
  set_box_menu,
  equip_menu,
  set_equip_menu,
  reveal_box,
  set_reveal_box,
  on_box_retry_blocked,
  on_box_retry_allowed,
  tooltip_element,
}) {
  const { t } = useTranslation()
  const [send_items, set_send_items] = useState(null)
  // OPEN re-submits loot_box::open_box (money path) — a box whose prior open is still unsettled/failed stays
  // latched (lootbox-retry-guard, TX-RETRY law) and the button below disables in place with the reason. CRUSH is
  // a DIFFERENT door (forgemagie::crush) — never gated by the open latch, so a box stuck on a broken open still
  // has a way OUT of the bag (fixing a reported "no disposal path" bug).
  const box_open_blocked = box_menu ? is_box_retry_blocked(box_menu.box.id) : false
  const pet_actions = project_inventory_context_actions(['feed', 'explorer'])
  const box_actions = project_inventory_context_actions(['open', 'crush', 'explorer'])
  const open_send = (item) => set_send_items([project_inventory_send_item(item, owned)])
  return (
    <>
      {pet_menu && (
        <div
          role="menu"
          onClick={(event) => event.stopPropagation()}
          style={{
            position: 'fixed',
            left: pet_menu.x,
            top: pet_menu.y,
            zIndex: 55,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            padding: 6,
            minWidth: 152,
            background: 'var(--surface, #12121a)',
            border: '1px solid var(--accent, #c8963c)',
            boxShadow: '0 12px 32px rgba(0,0,0,0.55)',
          }}
        >
          {pet_actions.includes('feed') && (
            <button
              type="button"
              className="hud-btn"
              onClick={() => {
                set_feed_modal({ pet: pet_menu.pet })
                set_pet_menu(null)
              }}
            >
              {t('pet.feed')}
            </button>
          )}
          {pet_actions.includes('send') && (
            <ItemSendMenuRow
              on_send={() => {
                open_send(pet_menu.pet)
                set_pet_menu(null)
              }}
            />
          )}
          {pet_actions.includes('explorer') && (
            <ExplorerMenuRow object_id={pet_menu.pet?.id} on_navigate={() => set_pet_menu(null)} />
          )}
        </div>
      )}
      {feed_modal && (
        <PetFeedModal
          pet={feed_modal.pet}
          foods={pet_feed_foods(owned, feed_modal.pet)}
          food_slugs={food_slugs}
          pet_max_stats={pet_max_stats}
          character={character}
          onClose={() => set_feed_modal(null)}
        />
      )}
      <CrushMenu
        menu={crush_menu}
        on_close={() => set_crush_menu(null)}
        confirm={crush_confirm}
        set_confirm={set_crush_confirm}
        on_send={open_send}
      />
      <EquipMenu menu={equip_menu} on_close={() => set_equip_menu(null)} />
      {box_menu && (
        <div
          role="menu"
          onClick={(event) => event.stopPropagation()}
          style={{
            position: 'fixed',
            left: box_menu.x,
            top: box_menu.y,
            zIndex: 55,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            padding: 6,
            minWidth: 152,
            background: 'var(--surface, #12121a)',
            border: '1px solid var(--accent, #c8963c)',
            boxShadow: '0 12px 32px rgba(0,0,0,0.55)',
          }}
        >
          {box_actions.includes('open') && (
            <button
              type="button"
              className="hud-btn"
              disabled={box_open_blocked}
              title={box_open_blocked ? t('lootbox.retry_blocked') : undefined}
              onClick={() => {
                set_reveal_box(box_menu.box)
                set_box_menu(null)
              }}
            >
              {t('lootbox.open')}
            </button>
          )}
          {box_actions.includes('crush') && (
            <button
              type="button"
              className="hud-btn"
              style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-start' }}
              onClick={() => {
                set_crush_confirm(box_menu.box)
                set_box_menu(null)
              }}
            >
              <Hammer size={12} style={{ color: 'var(--accent, #c8963c)' }} />
              {t('crush.action')}
            </button>
          )}
          {box_actions.includes('send') && (
            <ItemSendMenuRow
              on_send={() => {
                open_send(box_menu.box)
                set_box_menu(null)
              }}
            />
          )}
          {box_actions.includes('explorer') && (
            <ExplorerMenuRow object_id={box_menu.box?.id} on_navigate={() => set_box_menu(null)} />
          )}
        </div>
      )}
      {reveal_box && (
        <BoxReveal
          box={reveal_box}
          on_close={() => set_reveal_box(null)}
          on_retry_blocked={on_box_retry_blocked}
          on_retry_allowed={on_box_retry_allowed}
        />
      )}
      {send_items && <ItemSendModal items={send_items} on_close={() => set_send_items(null)} />}
      {tooltip_element}
    </>
  )
}
