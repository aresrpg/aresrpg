// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One paper-doll equipment slot. Renders the slot art + a level badge + a rarity-tinted bottom edge
// when filled, or a per-slot line glyph + caption when empty (canon-04 "Loadout" doll). Wires the
// select/unequip/drag-drop/right-click handlers. Hover → the SHARED onchain item tooltip (Inventory.jsx owns
// the single useOnchainItemTooltip instance + portal for the whole panel — bag cells AND equipped slots —
// so there is exactly one tooltip mounted, not one per slot). Right-click on a FILLED slot opens EquipMenu
// (it used to fall through to the native browser menu) — Inventory.jsx's on_context_menu
// preventDefaults so the native menu never fires.

import {
  Crown,
  Shirt,
  Gem,
  CircleDot,
  Minus,
  Footprints,
  Swords,
  Shield,
  Cat,
  Sparkles,
  Star,
  Award,
} from 'lucide-react'

import { ItemIcon } from './ItemIcon.jsx'
import { rarity_tint } from './quality.js'
import { inventory_item_icon, SLOT_LABEL } from './inventory-equip.js'

// Per-slot empty-state icon — REUSES the companion's canonical slot icon set (the lucide glyphs in
// components/items.tsx SLOT_ICONS used across the app) so every empty slot reads as the correct gear
// type. Keyed by SLOT_LABEL; `title` is a game-only slot (no companion equivalent) -> Award.
const SLOT_ICON = /** @type {Record<string, import('lucide-react').LucideIcon>} */ ({
  relic: Sparkles,
  helmet: Crown,
  hat: Crown, // #23 cosmetic HAT slot caption
  cloak: Shirt, // #23 cosmetic CLOAK slot caption
  amulet: Gem,
  chestplate: Shirt,
  gauntlets: Shield,
  pants: Star,
  title: Award,
  weapon: Swords,
  ring: CircleDot,
  belt: Minus,
  boots: Footprints,
  pet: Cat,
})

/** One paper-doll slot. `slug_by_name` is the item-catalog name→slug join the BAG cells resolve icons
 * with (virtual:item_catalog, passed down by Inventory — this module stays virtual-free for bun tests);
 * the doll runs the exact same inventory_item_icon resolve so the two surfaces can never diverge. */
export function EquipmentSlot({
  slot,
  item,
  selected,
  valid,
  slug_by_name,
  on_select,
  on_unequip,
  on_drag_start,
  on_drag_end,
  on_drop,
  on_hover_enter,
  on_hover_move,
  on_hover_leave,
  on_context_menu,
  on_activate,
}) {
  const label = SLOT_LABEL[slot]
  const Glyph = SLOT_ICON[label] ?? Sparkles
  // `on_activate` makes the WHOLE cell — empty included — a keyboard-reachable activation target. The chain
  // inventory doesn't pass it (its empty slots are drop targets, filled ones are selected by their art), but
  // a surface that ASSIGNS gear by picking from a catalog needs the empty cell itself to open the picker.
  const activation = on_activate
    ? {
        role: 'button',
        tabIndex: 0,
        onClick: on_activate,
        onKeyDown: (/** @type {any} */ e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            on_activate()
          }
        },
      }
    : {}
  // Shared rarity CELL treatment (rarity_tint SSOT, quality.js): the inset radial gradient, painted as a
  // background layer by the CSS — never a border/edge. One source across every item cell (D11).
  const tint = item ? rarity_tint(item.quality ?? item.rarity) : null
  return (
    <div
      className={`inv__slot inv__slot--${slot}${item ? ' is-filled' : ''}${
        selected ? ' is-selected' : ''
      }${valid ? ' is-valid' : ''}`}
      style={
        item
          ? /** @type {import('react').CSSProperties} */ ({ '--q-tint': tint })
          : undefined
      }
      onDragOver={e => e.preventDefault()}
      onDrop={on_drop}
      {...activation}
    >
      {item ? (
        <>
          <span
            className="inv__slot-art"
            draggable
            onClick={on_select}
            onDoubleClick={on_unequip}
            onContextMenu={on_context_menu}
            onDragStart={e => {
              e.dataTransfer.setData('text/plain', item.id)
              on_drag_start()
            }}
            onDragEnd={on_drag_end}
            onMouseEnter={e => on_hover_enter?.(e, item)}
            onMouseMove={on_hover_move}
            onMouseLeave={on_hover_leave}
          >
            <ItemIcon
              item={{
                icon: inventory_item_icon(item, slug_by_name),
                category: item.item_category ?? item.category,
              }}
              alt={item.name}
            />
          </span>
          <span className="inv__slot-lvl hud-num">{item.level ?? 0}</span>
        </>
      ) : (
        <>
          <Glyph className="inv__slot-glyph" strokeWidth={1.5} aria-hidden="true" />
          <span className="inv__slot-label">{label}</span>
        </>
      )}
    </div>
  )
}
