// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE TYPE-LIST PROJECTION (issue #31 ①). item_display_category() collapses every wearable cosmetic
// (hat/cloak/title) to the single bucket COSMETICS so the top-level GROUP pills stay coarse — correct for
// grouping, but it means the encyclopedia's per-group sub-category breakdown had NOTHING left to divide the
// COSMETICS group by (every cosmetic item.category is the same string), so the sub-category rail silently
// never appeared for cosmetics and every cosmetic card's under-label read the same generic "COSMETICS" —
// issue #31 ②'s "wrong type label". The FIX is not a new taxonomy: `item.item_type` (the raw on-chain
// equip slot — hat/cloak/title) is present on every encyclopedia item row untouched (items_tab.tsx) and is
// EXACTLY the marketplace's own "third browse column" concept (marketplace_model.ts's
// marketplace_item_type_of) — reused here so cosmetic-type resolution has one home, not two.
import { marketplace_item_type_of, marketplace_item_type_key } from '../../components/marketplace/marketplace_model'
import { COSMETICS_CATEGORY } from '../../game/item_classification'

export type ItemTypeBucket = { type: string; count: number }

interface TypeableItem {
  category: string
  item_type?: string
}

/** The label-worthy type for one item: the specific cosmetic slot (HAT/CLOAK/TITLE) for a cosmetic, else
 *  its own category untouched. Every OTHER card (weapons, armor, …) is unaffected — this only stops
 *  COSMETICS from swallowing the one field that actually distinguishes its rows. */
export function item_type_of(item: Readonly<TypeableItem>): string {
  return item.category === COSMETICS_CATEGORY
    ? marketplace_item_type_of(item.category, item.item_type ?? '')
    : item.category
}

/** The i18n key for an item's type label — `entity.category.<type>`, the same keyed family every other
 *  category label already reads (entity.category.hat / .cloak / .title already exist in all 6 locales). */
export function item_type_label_key(item: Readonly<TypeableItem>): string {
  return marketplace_item_type_key(item_type_of(item))
}

/** The sub-category rail's buckets for the ACTIVE group's items: distinct types present, with live counts,
 *  sorted by count desc then name — mirrors marketplace_item_type_buckets's ordering. A group whose items
 *  share one type (or where item_type_of is uniform, e.g. every non-cosmetic group) naturally reduces to
 *  one bucket; the caller hides the rail then (marketplace_has_subcategories's "redundant" rule, D#31). */
export function item_type_buckets(items: readonly Readonly<TypeableItem>[]): ItemTypeBucket[] {
  const counts = new Map<string, number>()
  for (const item of items) {
    const type = item_type_of(item)
    if (!type) continue
    counts.set(type, (counts.get(type) ?? 0) + 1)
  }
  return [...counts]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))
}
