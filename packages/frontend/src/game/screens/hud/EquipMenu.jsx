// EQUIP-SLOT MENU — right-click on an EQUIPPED paper-doll/cosmetic slot (right-clicking
// gear/a cosmetic fell through to the native browser menu, no "See on explorer"). Explorer-only on purpose:
// UNEQUIP already has a working click affordance on the slot art itself (EquipmentSlot.jsx
// `onDoubleClick={on_unequip}`), so this popover doesn't duplicate it. Mirrors CrushMenu / the pet+box menus'
// EXACT idiom (crush_menu.tsx, InventoryOverlays.jsx) — fixed-position div at the click point, outside-click/
// Escape dismiss, same chrome — no new menu system, just the one explorer row.
import { useEffect } from 'react'

import { ExplorerMenuRow } from '../../../components/explorer_link'

/** @typedef {{ x: number, y: number, item: any } | null} EquipMenuTarget */

/**
 * @param {{ menu: EquipMenuTarget, on_close: () => void }} props
 */
export function EquipMenu({ menu, on_close }) {
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
      onClick={e => e.stopPropagation()}
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
      <ExplorerMenuRow object_id={menu.item?.id} on_navigate={on_close} />
    </div>
  )
}
