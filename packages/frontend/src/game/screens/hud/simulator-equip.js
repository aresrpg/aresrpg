// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Simulator equipment MATH (NO JSX): which published templates a slot accepts, and what one contributes at
// its MAX stat roll (the theorycraft ceiling), so the simulator shows the best-case build while the live
// Character tab still shows the real rolled values.
//
// WHERE the templates come from is deliberately NOT here — pages/encyclopedia/item_corpus.ts owns that (the
// live /v1 corpus, sibling of the world corpus). This file used to BROWSE the bundled
// `@aresrpg/sdk/items-data` catalog, which is `{}` by construction in this repo: that is what rendered every
// gear picker empty on a real deployment.

import { equip_slot_accepts } from './inventory_context_actions'
import { EQUIPMENT_SLOTS, SLOT_LABEL } from './inventory-equip.js'

export { EQUIPMENT_SLOTS, SLOT_LABEL }

/** @typedef {import('../../../pages/encyclopedia/item_corpus').CorpusItem} CorpusItem */

/**
 * The corpus rows a slot legally accepts — `equip_slot_accepts` is the exact `equipment.move` `slot_kind_of`
 * table, read off the RAW Move category a template carries. Deliberately NOT the legacy SDK category bridge
 * (`to_chain_category`), which collapses the distinct chestplate/gauntlets/pants slots into cloak/belt/boots,
 * and deliberately NOT `is_slot_valid`, whose cosmetic branch keys on `item_type` — on a TEMPLATE row that
 * field is the authored art slug, not a slot word.
 * @param {string} slot @param {readonly CorpusItem[]} items @returns {CorpusItem[]}
 */
export const items_for_slot = (slot, items) => items.filter((item) => equip_slot_accepts(slot, item))

/**
 * Flatten a live item template into an equipped-slot object: its authored stat RANGES become flat MAX fields
 * keyed exactly as get_total_stat reads them (vitality / ap / critical / *_resistance / ...), plus the
 * identity get_total_stat and the paper doll need. THE max-roll resolver — the simulator never rolls locally.
 *
 * `category` is the raw Move category and doubles as `item_category`: it is the immutable word stamped from
 * the authored ItemTemplate onto every Item and projected unchanged by /v1, so no category bridge belongs
 * between the wire and the stat math.
 * @param {CorpusItem} item @returns {Record<string, any>}
 */
export function equip_item(item) {
  /** @type {Record<string, number>} */
  const flat = {}
  for (const [key, range] of Object.entries(item.stats ?? {})) {
    const max = Array.isArray(range) ? (range[1] ?? range[0] ?? 0) : Number(range)
    if (max) flat[key] = max
  }
  return {
    id: item.id,
    name: item.name || item.id,
    category: item.category,
    level: item.level,
    item_type: item.item_type,
    damages: item.damages ?? [],
    item_category: item.category,
    is_aresrpg_character: false,
    ...flat,
  }
}
