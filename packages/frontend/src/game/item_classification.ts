// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { ITEM_CATEGORY } from '@aresrpg/sdk/items'

export const COSMETICS_CATEGORY = 'COSMETICS' as const

export interface ItemClassificationInput {
  item_type?: string | null
  itemType?: string | null
  item_category?: string | null
  category?: string | null
}

export interface ItemTypeClassification {
  category: typeof COSMETICS_CATEGORY
  equip_slot: string
}

/**
 * The single frontend home for itemType-derived presentation facts. Current seed/mainnet vanity rows carry no
 * slot field: their itemType is the Move equipment slot truth. Keep this table limited to types that exist in
 * seed/mainnet/shop.json and in equipment.move's cosmetic slot dispatcher.
 */
export const COSMETIC_ITEM_TYPES: Readonly<Record<string, ItemTypeClassification>> = Object.freeze({
  [ITEM_CATEGORY.HAT]: Object.freeze({ category: COSMETICS_CATEGORY, equip_slot: ITEM_CATEGORY.HAT }),
  [ITEM_CATEGORY.CLOAK]: Object.freeze({ category: COSMETICS_CATEGORY, equip_slot: ITEM_CATEGORY.CLOAK }),
  [ITEM_CATEGORY.TITLE]: Object.freeze({ category: COSMETICS_CATEGORY, equip_slot: ITEM_CATEGORY.TITLE }),
})

const normalized_item_type = (item: ItemClassificationInput | null | undefined): string =>
  String(item?.item_type ?? item?.itemType ?? '').toLowerCase()

export function item_type_classification(
  item: ItemClassificationInput | null | undefined
): ItemTypeClassification | null {
  return COSMETIC_ITEM_TYPES[normalized_item_type(item)] ?? null
}

/** Display category for encyclopedia/inventory grouping; non-cosmetics retain their source category. */
export function item_display_category(item: ItemClassificationInput | null | undefined): string {
  return (
    item_type_classification(item)?.category ?? String(item?.category ?? item?.item_category ?? '').toUpperCase()
  )
}

/** Cosmetic equip slot from itemType, or null when category-based equipment logic should decide. */
export function item_type_equip_slot(item: ItemClassificationInput | null | undefined): string | null {
  return item_type_classification(item)?.equip_slot ?? null
}

export function is_cosmetic_item(item: ItemClassificationInput | null | undefined): boolean {
  return item_type_classification(item) !== null
}

/** Categories rendered as a worn mannequin preview — the `cosmetic_icon` Walrus quilt. TITLE is deliberately
 *  excluded: title cosmetics (e.g. the veteran scroll) render as an ordinary item icon, never a worn preview,
 *  so they resolve through the `item` quilt like any other inventory icon. */
const WEARABLE_ICON_CATEGORIES = new Set([ITEM_CATEGORY.HAT.toUpperCase(), ITEM_CATEGORY.CLOAK.toUpperCase()])

/**
 * The published Walrus quilt class for an item's icon art, derived from its raw category/itemType. Shared by
 * the shop vitrine and the encyclopedia so the wearable-vs-item split has one home instead of two copies that
 * can drift (the encyclopedia previously hardcoded cosmetic_icon for every cosmetic and 404'd title art).
 */
export function icon_asset_class(category: string | null | undefined): 'item' | 'cosmetic_icon' {
  return WEARABLE_ICON_CATEGORIES.has(String(category ?? '').toUpperCase()) ? 'cosmetic_icon' : 'item'
}

/**
 * The icon key of a live /v1 item row IS its `item_type` — the authored art slug the seed uploads
 * `items/{item_type}.png` under and the same key item.move's Display bakes, so a chain mint and a client
 * render can never disagree. Returns null when the row has none, which the caller degrades to its glyph.
 *
 * CHAIN TRUTH (live /v1 encyclopedia census, 2026-07-25 — 1854 rows): `item_type` is unique on 1854/1854
 * rows; the GENERIC family word is `category` (30 values). Earlier revisions of this resolver confused the
 * two and derived the key from the DISPLAY NAME instead, which diverges from item_type on 984 rows — of
 * those the name-derived key served 2 icons and item_type serves 515 (HEAD-probed against
 * assets.aresrpg.world; the remainder is genuinely unpublished art, issue #764's row, not a key bug). That
 * derivation is deleted rather than ranked behind item_type: a guessed key produces a blind 404 for every
 * item whose art simply is not uploaded yet, and a name is not an art identity. Its two crutches go with
 * it — the `pet_*` special case (item_type was always the key, pets included) and the `icon_slug_map`
 * runtime blob (issue #160), a name->slug join that only ever existed to recover what item_type carries
 * natively ('Bag of Nightcaps' -> `bag_nightcap`, 'Aftershock' -> `riftsunder_blade`).
 */
export function chain_icon_slug(item: { item_type?: string | null } | null | undefined): string | null {
  return item?.item_type || null
}

/**
 * THE one grouping home for stackable items (issue #10 — the HUD bag grid and marketplace SELL grid each grew
 * their own copy of this merge and could disagree; both now call this). Merges same-identity rows into one
 * display row with a summed count. Identity = `template_id` first, `item_type`/`id` only for rows without one
 * (bare test fixtures) — NEVER `item_type` alone: two different templates can share a display slug, and
 * merging on the slug hides a stale template's item behind a valid one (the petbox bug, fixed 07-20).
 * `amount_field` names the row's own count property (`amount`/`quantity`); every merge floors it to at least 1.
 */
export function group_by_stack_identity(rows: readonly any[], amount_field: string): any[] {
  const grouped = new Map<string, any>()
  for (const item of rows) {
    const key = item.template_id || item.item_type || item.id
    const count = item[amount_field] > 1 ? item[amount_field] : 1
    const existing = grouped.get(key)
    if (existing) existing[amount_field] += count
    else grouped.set(key, { ...item, [amount_field]: count })
  }
  return [...grouped.values()] // Map preserves insertion (first-seen) order
}
