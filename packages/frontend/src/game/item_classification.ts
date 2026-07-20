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
