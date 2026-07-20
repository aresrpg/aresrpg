// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Simulator equipment helpers (NO JSX). Lets the build planner equip seeded template items per slot
// and feeds their stat contributions into the SDK stat math. SSOT reuse: the slot set + slot-validity
// come from inventory-equip.js (the inventory paper-doll), the fine->slot category bridge from
// @aresrpg/sdk/items (to_chain_category), and the item templates from @aresrpg/sdk/items-data — this file
// invents none of them. An equipped template contributes its MAX stat roll (theorycraft ceiling), so
// the planner shows the best-case build; the live Character tab still shows the real rolled values.

import items_json from '@aresrpg/sdk/items-data' with { type: 'json' }
import { to_chain_category } from '@aresrpg/sdk/items'
import { is_developer_item } from '@aresrpg/sdk/jobs'

import {
  EQUIPMENT_SLOTS,
  SLOT_LABEL,
  is_slot_valid,
} from './inventory-equip.js'

export { EQUIPMENT_SLOTS, SLOT_LABEL }

/** @typedef {import('./encyclopedia-data.js').ItemDef} ItemDef */

const ITEMS = /** @type {Record<string, ItemDef>} */ (
  /** @type {unknown} */ (items_json)
)

// Browsable equipment templates (developer/cheat items excluded).
const LIST = /** @type {ItemDef[]} */ (
  Object.values(ITEMS).filter(it => !is_developer_item(it))
)

// Move now has distinct body-armour slots while the legacy SDK bridge still collapses them. Preserve those
// real slot categories here; weapons/tools continue through the SDK bridge.
const inventory_category = (/** @type {string} */ category) => {
  const normalized = String(category ?? '').toLowerCase()
  return ['helmet', 'chestplate', 'gauntlets', 'pants'].includes(normalized)
    ? normalized
    : to_chain_category(normalized)
}

// Adapt an items.json ItemDef into the shape is_slot_valid expects.
const as_inventory_shape = (/** @type {ItemDef} */ item) => ({
  ...item,
  item_category: inventory_category(item.category),
})

/** @type {Record<string, ItemDef[]>} */
const BY_SLOT = {}

/**
 * The seeded items valid for a slot, sorted by level then name. Memoised per slot.
 * @param {string} slot @returns {ItemDef[]}
 */
export function items_for_slot(slot) {
  const cached = BY_SLOT[slot]
  if (cached) return cached
  const out = LIST.filter(it =>
    is_slot_valid(slot, as_inventory_shape(it)),
  ).sort(
    (a, b) =>
      a.level - b.level || (a.name || a.id).localeCompare(b.name || b.id),
  )
  BY_SLOT[slot] = out
  return out
}

/** Slots that actually have selectable templates (hides e.g. an empty `title` slot from the UI). */
export const EQUIPPABLE_SLOTS = EQUIPMENT_SLOTS.filter(
  slot => items_for_slot(slot).length > 0,
)

/**
 * Flatten an ItemDef into an equipped-slot object: its stat ranges become flat MAX fields keyed
 * exactly as get_total_stat reads them (vitality / ap / critical / *_resistance / ...), plus the
 * identity get_total_stat + the picker need. Produced once per equip and stored in the slot.
 * @param {ItemDef} item @returns {Record<string, any>}
 */
export function equip_item(item) {
  /** @type {Record<string, number>} */
  const flat = {}
  for (const [key, range] of Object.entries(item.stats ?? {})) {
    const max = Array.isArray(range)
      ? (range[1] ?? range[0] ?? 0)
      : Number(range)
    if (max) flat[key] = max
  }
  return {
    id: item.id,
    name: item.name || item.id,
    category: item.category,
    quality: item.quality,
    level: item.level,
    icon: item.icon,
    damages: item.damages ?? [],
    item_category: inventory_category(item.category),
    is_aresrpg_character: false,
    ...flat,
  }
}

/** Empty equipment map (every slot null) — the planner's starting + reset state. */
export const empty_equipment = () =>
  /** @type {Record<string, any>} */ (
    Object.fromEntries(EQUIPMENT_SLOTS.map(slot => [slot, null]))
  )
