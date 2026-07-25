// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE PAPER DOLL — the ONE home for the equipment layout: the six-relic rail, the anatomical body rig, and
// the three cosmetic slots. DOM reading order IS the layout (hud-panels.css `.inv__rig` auto-flow), so the
// slot ORDER is part of this component, not of its callers.
//
// Extracted VERBATIM out of Inventory.jsx (the chain-backed inventory panel), which now re-composes it. The
// no-divergence law is the reason: the simulator assigns the same slots and must show the same doll — a
// second slot grid would be a second truth about where the pet slot sits.
//
// Presentation only. Every behaviour arrives through `slot_props(slot)`, the caller's per-slot prop builder
// (see Inventory.jsx's own `slot_props` for the full shape EquipmentSlot consumes) — so the chain panel wires
// staging/drag/tooltips and the simulator wires "open the picker", over identical markup.

import { EquipmentSlot } from './EquipmentSlot.jsx'
import { RELIC_SLOTS } from './inventory-equip.js'
import './hud-panels.css'

/** The cosmetic slots, in render order — the three real Move slots (#23). */
export const COSMETIC_SLOTS = /** @type {const} */ (['hat', 'cloak', 'title'])

/** The anatomical body rig, in DOM = layout order. */
export const RIG_SLOTS = /** @type {const} */ ([
  'helmet',
  'amulet',
  'gauntlets',
  'chestplate',
  'weapon',
  'left_ring',
  'belt',
  'right_ring',
  'pet',
  'pants',
  'boots',
])

/**
 * The doll: relic rail + body rig, with an optional footer row (the inventory's Accept/Cancel commit bar).
 *
 * `flat` drops the doll's own frame (border + fill + padding) and keeps only the layout. A surface that is
 * ALREADY a card — a dialog — must not nest a second framed card inside itself; the slot cells are the only
 * containment that level of the page needs. The chain inventory sits in a scrolling panel and keeps its frame.
 * @param {{ slot_props: (slot: string) => object, footer?: import('react').ReactNode, flat?: boolean }} props
 */
export function EquipmentDoll({ slot_props, footer = null, flat = false }) {
  return (
    <div className={`inv__doll${flat ? ' inv__doll--flat' : ''}`}>
      <div className="inv__doll-body">
        <div className="inv__relics">
          {RELIC_SLOTS.map((slot) => (
            <EquipmentSlot key={slot} {...slot_props(slot)} />
          ))}
        </div>
        <div className="inv__rig">
          {/* Cosmetics live in their own real slots below. The spacer keeps the combat
              spine (helmet/chestplate/belt/pants) column-centred. */}
          <div className="inv__slot-gap" aria-hidden="true" />
          {RIG_SLOTS.map((slot) => (
            <EquipmentSlot key={slot} {...slot_props(slot)} />
          ))}
        </div>
      </div>
      {footer}
    </div>
  )
}

/** The three cosmetic slots — the same slot grid as the rig, wired through the same prop builder. */
export function CosmeticSlots({ slot_props }) {
  return (
    <div className="inv__cosmetics">
      {COSMETIC_SLOTS.map((slot) => (
        <EquipmentSlot key={slot} {...slot_props(slot)} />
      ))}
    </div>
  )
}
