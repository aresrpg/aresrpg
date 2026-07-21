// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { ITEM_CATEGORY } from '@aresrpg/sdk/items'

import { get_icon_slug_map } from './data/icon_slug_map.js'

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
 * A slug from a display name: lowercase, diacritics stripped, every non-alphanumeric run collapsed to a single
 * underscore, ends trimmed. The seed authors item icon files this way ('Cinder Heart' -> `cinder_heart.png`,
 * 'Void Eye Talisman' -> `void_eye_talisman.png` — both curl-verified 200 on the live icon quilts), so it is
 * the icon key for every class whose on-chain `item_type` is only the generic family word.
 */
export const slugify_name = (name: string | null | undefined): string =>
  String(name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

/**
 * The icon slug derivable from a live /v1 item row when NO authored seed slug is bundled. Production ships an
 * EMPTY `virtual:item_catalog` (the seed name->icon map is private — vite.config.ts catalog_fallback_plugin),
 * so every /v1 encyclopedia/owner-items row arrives WITHOUT a `slug`, and the icon must come from the row's own
 * fields. Pets carry their UNIQUE slug AS `item_type` ('pet_timon', 'pet_lootbox') and resolve through that
 * alone — the map is never consulted for pets, matching the content-side count reconciliation on issue #160
 * (42 would-be pet name/map mismatches are false positives, item_type already resolves them correctly).
 *
 * Every other class's on-chain `item_type` is only the generic family word ('chestplate'/'resource'/'senshi'
 * — 51 families over 1840 items), so the icon key comes from the display name — MAP-FIRST: the published
 * `icon_slug_map` runtime blob (issue #160) joins ~1,781 display names to their AUTHORED icon slug, recovering
 * the ~900 items whose art lives under a slug the name-derivation misses (renames, `bag_of_*` phrasing,
 * apostrophes — e.g. 'Bag of Nightcaps' -> `bag_nightcap`, not the slugified `bag_of_nightcaps`). A name absent
 * from the map (or the map not yet loaded — icon_slug_map.js degrades loudly, never throws) falls through to
 * the slugified display name ('cinder_heart'), the same derivation this function always used. Returns null
 * when neither is derivable — the caller keeps its generic `item_type`/glyph fallback. ItemImage still owns
 * the 404 -> category-glyph degrade, so an item whose art is genuinely unpublished (seed#137) is an honest
 * missing candidate here, never a wrong icon.
 */
export function chain_icon_slug(item: { item_type?: string | null; name?: string | null } | null | undefined): string | null {
  const item_type = item?.item_type
  if (typeof item_type === 'string' && item_type.startsWith('pet_')) return item_type
  const name = item?.name
  const authored_slug = typeof name === 'string' ? get_icon_slug_map()[name] : undefined
  return authored_slug || slugify_name(name) || null
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
