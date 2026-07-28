// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { MarketplaceListing } from '../../types/chain'
import { is_cosmetic_item } from '../../game/item_classification'
import { EQUIPMENT_CATEGORIES, PET_CATEGORIES, RUNE_CATEGORIES } from '../../constants/item_categories'

export { marketplace_purchase_total_mist } from '../../utils/marketplace_purchase'

export const MARKETPLACE_LOT_SIZES = [1, 10, 100, 1000] as const
export type MarketplaceLotSize = (typeof MARKETPLACE_LOT_SIZES)[number]

export function marketplace_lot_sizes_for_owned_quantity(owned_quantity: number): MarketplaceLotSize[] {
  if (!Number.isSafeInteger(owned_quantity) || owned_quantity < 1) return []
  return MARKETPLACE_LOT_SIZES.filter((size) => size <= owned_quantity)
}

const STACKABLE_MARKET_CATEGORIES = new Set(['Consumable', 'Resource', 'Rune'])

export function is_marketplace_lot_size(amount: number): amount is MarketplaceLotSize {
  return Number.isSafeInteger(amount) && MARKETPLACE_LOT_SIZES.includes(amount as MarketplaceLotSize)
}

export function is_stackable_marketplace_listing(listing: MarketplaceListing): boolean {
  return STACKABLE_MARKET_CATEGORIES.has(listing.item.category)
}

// Defensive view-model gate for legacy/pre-rule rows. Stackable listings without an indexed amount also arrive
// as quantity 0, so they fail closed; non-stackable marketplace rows keep their ordinary amount untouched.
export function marketplace_listing_is_visible(listing: MarketplaceListing): boolean {
  return !is_stackable_marketplace_listing(listing) || is_marketplace_lot_size(listing.item.quantity)
}

export function visible_marketplace_listings(listings: MarketplaceListing[]): MarketplaceListing[] {
  return listings.filter(marketplace_listing_is_visible)
}

export type MarketplaceLotOffer = {
  size: MarketplaceLotSize
  asks: MarketplaceListing[]
  cheapest: MarketplaceListing | null
}

export function marketplace_lot_offers(listings: MarketplaceListing[]): MarketplaceLotOffer[] {
  const visible = visible_marketplace_listings(listings)
  return MARKETPLACE_LOT_SIZES.map((size) => {
    const asks = visible
      .filter((listing) => listing.item.quantity === size)
      .sort((left, right) => {
        const price_left = BigInt(left.price_mist)
        const price_right = BigInt(right.price_mist)
        return price_left < price_right ? -1 : price_left > price_right ? 1 : left.id.localeCompare(right.id)
      })
    return {
      size,
      asks,
      cheapest: asks[0] ?? null,
    }
  })
}

export function marketplace_available_lot_ask(
  asks: MarketplaceListing[],
  address: string | null
): MarketplaceListing | null {
  return asks.find((ask) => !address || ask.seller_sui_address !== address) ?? null
}

export function confirm_marketplace_lot_ask(
  asks: MarketplaceListing[],
  address: string | null,
  on_buy: (listing: MarketplaceListing) => void
): MarketplaceListing | null {
  const ask = marketplace_available_lot_ask(asks, address)
  if (ask) on_buy(ask)
  return ask
}

export type MarketplaceCategory =
  'COSMETICS' | 'EQUIPMENT' | 'PETS' | 'RUNES' | 'CONSUMABLE' | 'RESOURCES' | 'CHARACTERS'

export const MARKETPLACE_CATEGORIES: MarketplaceCategory[] = [
  'COSMETICS',
  'EQUIPMENT',
  'PETS',
  'RUNES',
  'CONSUMABLE',
  'RESOURCES',
  'CHARACTERS',
]

export const MARKETPLACE_CATEGORY_KEYS: Record<MarketplaceCategory, string> = {
  COSMETICS: 'marketplace.cat_cosmetics',
  EQUIPMENT: 'marketplace.cat_equipment',
  PETS: 'marketplace.cat_pets',
  RUNES: 'marketplace.cat_runes',
  CONSUMABLE: 'marketplace.cat_consumable',
  RESOURCES: 'marketplace.cat_resources',
  CHARACTERS: 'marketplace.cat_characters',
}

const EQUIPMENT_CATEGORY_KEYS = new Set([...EQUIPMENT_CATEGORIES].map((category) => category.toLowerCase()))
const PET_CATEGORY_KEYS = new Set([...PET_CATEGORIES].map((category) => category.toLowerCase()))
const RUNE_CATEGORY_KEYS = new Set([...RUNE_CATEGORIES].map((category) => category.toLowerCase()))

export function marketplace_category_of(category: string, item_type: string): MarketplaceCategory {
  const category_key = String(category).trim().toLowerCase()
  if (is_cosmetic_item({ item_type })) return 'COSMETICS'
  if (PET_CATEGORY_KEYS.has(category_key)) return 'PETS'
  if (RUNE_CATEGORY_KEYS.has(category_key)) return 'RUNES'
  if (category_key === 'consumable') return 'CONSUMABLE'
  if (category_key === 'resource') return 'RESOURCES'
  if (EQUIPMENT_CATEGORY_KEYS.has(category_key)) return 'EQUIPMENT'
  return 'EQUIPMENT'
}

// Seed `category` is the semantic browse subtype. Raw seed `itemType` cannot be used generally because weapon
// rows store their wielding class there; cosmetics are the one intentional exception, where itemType is the
// wearable slot (hat / cloak / title) and their display category has already collapsed to COSMETICS.
export function marketplace_item_type_of(category: string, item_type: string): string {
  const semantic_type = is_cosmetic_item({ item_type }) ? item_type : category
  return String(semantic_type)
    .trim()
    .replace(/[\s-]+/g, '_')
    .toUpperCase()
}

export function marketplace_item_type_key(item_type: string): string {
  return `entity.category.${item_type.toLowerCase()}`
}

export type MarketplaceTaxonomyEntry = {
  category: string
  item_type: string
  listing_count?: number
}

export type MarketplaceItemTypeBucket = {
  item_type: string
  listing_count: number
}

// A sub-category column must not render when there is none to show — a lone "pet > pet" bucket is noise. A subcategory
// column earns its place only when it DIVIDES the category into more than one bucket; a lone bucket IS the
// whole category (pet→pet, rune→rune, consumable→consumable), so the column is pure noise and must vanish.
export function marketplace_has_subcategories(item_types: MarketplaceItemTypeBucket[]): boolean {
  return item_types.length > 1
}

export function marketplace_item_type_buckets(
  entries: MarketplaceTaxonomyEntry[],
  category: MarketplaceCategory
): MarketplaceItemTypeBucket[] {
  if (category === 'CHARACTERS') return []
  const counts = new Map<string, number>()
  for (const entry of entries) {
    if (marketplace_category_of(entry.category, entry.item_type) !== category) continue
    const item_type = marketplace_item_type_of(entry.category, entry.item_type)
    if (!item_type) continue
    counts.set(item_type, (counts.get(item_type) ?? 0) + (entry.listing_count ?? 0))
  }
  return [...counts]
    .map(([item_type, listing_count]) => ({ item_type, listing_count }))
    .sort(
      (left, right) =>
        Number(right.listing_count > 0) - Number(left.listing_count > 0) ||
        left.item_type.localeCompare(right.item_type)
    )
}

export type MarketplaceTypeBucket = {
  template_id: string
  asset_slug: string
  classification_item_type: string
  catalog_name: string
  name: string
  level: number
  category: string
  browse_category: string
  rarity: string
  appearance: string
  stackable: boolean
  total: number
  cheapest_unit: bigint
  listings: MarketplaceListing[]
  detail_resolved: boolean
}

export type MarketplaceCatalogEntry = {
  rarity?: string
  item_type?: string
  stats: Record<string, number | [number, number]>
  damages: { element: string; from: number; to: number; damage_type?: string }[]
}

export type MarketplaceDetailItem = {
  id?: string
  /** DISPLAY-FIRST resolved icon URL (cosmetic-aware, via the one marketplace icon home) — wins over the
   *  slug-built icon inside ItemImage so a listed cosmetic shows its real art. */
  image_url?: string
  appearance?: string
  name: string
  category: string
  rarity: string
  level: number
  damages: { element: string; from: number; to: number; damage_type?: string }[]
  stats: Record<string, number | [number, number]>
}

export function marketplace_detail_item(
  type: MarketplaceTypeBucket,
  catalog_entry: MarketplaceCatalogEntry | undefined,
  asset_slug: string | undefined
): MarketplaceDetailItem {
  const main_category = marketplace_category_of(type.category, type.classification_item_type)
  return {
    id: asset_slug || type.template_id,
    appearance: type.appearance,
    name: type.name,
    category: main_category === 'COSMETICS' ? 'COSMETICS' : type.category,
    rarity: catalog_entry?.rarity ?? type.rarity ?? '',
    level: type.level,
    damages: catalog_entry?.damages ?? [],
    stats: catalog_entry?.stats ?? {},
  }
}

export function marketplace_type_matches(type: MarketplaceTypeBucket, search: string): boolean {
  const needle = search.trim().toLocaleLowerCase()
  if (!needle) return true
  return `${type.name} ${type.category}`.toLocaleLowerCase().includes(needle)
}

export function marketplace_types_for_item_type(
  types: MarketplaceTypeBucket[],
  category: MarketplaceCategory,
  item_type: string | null,
  search: string
): MarketplaceTypeBucket[] {
  if (!item_type || category === 'CHARACTERS') return []
  return types.filter(
    (type) =>
      marketplace_category_of(type.browse_category, type.classification_item_type) === category &&
      marketplace_item_type_of(type.browse_category, type.classification_item_type) === item_type &&
      marketplace_type_matches(type, search)
  )
}
