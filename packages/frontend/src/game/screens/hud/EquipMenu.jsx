// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// EQUIP-SLOT MENU — right-click on an EQUIPPED paper-doll/cosmetic slot (right-clicking
// gear/a cosmetic fell through to the native browser menu, no "See on explorer"). SEND is projected here too,
// but stays disabled with an explicit unequip-first reason because equipped objects have left the loose kiosk bag.
// UNEQUIP already has a working double-click affordance on the slot art itself (EquipmentSlot.jsx). Mirrors
// CrushMenu / the pet+box menus' fixed-position popover idiom with outside-click/Escape dismissal.
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { ExplorerMenuRow } from '../../../components/explorer_link'
import { ItemSendMenuRow } from '../../../components/item_send_menu_row'
import { project_inventory_context_actions } from './inventory_context_actions'

/** @typedef {{ x: number, y: number, item: any, character_id?: string | null } | null} EquipMenuTarget */

/**
 * @param {{ menu: EquipMenuTarget, on_close: () => void }} props
 */
export function EquipMenu({ menu, on_close }) {
  const { t } = useTranslation()
  const actions = project_inventory_context_actions(['explorer'])
  // Outside-click / Escape dismiss — same idiom as CrushMenu.
  useEffect(() => {
    if (!menu) return undefined
    const close = () => on_close()
    const on_key = (/** @type {KeyboardEvent} */ e) => {
      if (e.key === 'Escape') on_close()
    }
    window.addEventListener('click', close)
    window.addEventListener('keydown', on_key)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', on_key)
    }
  }, [menu, on_close])

  if (!menu) return null

  return (
    <div
      role="menu"
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: menu.x,
        top: menu.y,
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
      {actions.includes('send') && <ItemSendMenuRow disabled title={t('gift.send.unequip_first')} />}
      {actions.includes('explorer') && (
        // Every item this menu renders is EQUIPPED by construction, i.e. wrapped into the character — so the
        // explorer target is the character's page, never the item's own (dead) id. #1226.
        <ExplorerMenuRow
          object_id={menu.item?.id}
          equipped_character_id={menu.character_id}
          on_navigate={on_close}
        />
      )}
    </div>
  )
}
