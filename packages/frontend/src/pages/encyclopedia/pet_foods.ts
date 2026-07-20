// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PET FOOD display joins: the encyclopedia shows what food a pet is
// using, and the item detail card in the inventory (hover) does too — pure data, no JSX; the components
// (pet_food_section.tsx + the entity_tooltip hover row) only resolve display names and render.
//
// THE MECHANIC IS PET-AGNOSTIC (uniform law): on-chain, `pet::feed_pet` gates the burned food on
// membership in the ONE shared `PetFeedConfig.foods` table (packages/move/aresrpg/sources/pet.move,
// EUnknownFood) — never on the pet's identity — and every configured food grants exactly one daily
// feed. So EVERY pet honestly "eats" the same global food set; the per-pet petFeedItemsJson lists are
// offline authoring inputs whose union minted that config. The set itself is derived from seed at
// build/serve time by `build_pet_food_slugs` (scripts/lib/item_catalog_transform.mjs) and embedded as
// `pet_food_slugs` on `virtual:item_catalog` — callers bind it at the call site (the same injection
// idiom as item_catalog.ts CatalogData), so bun tests recompute live from seed with zero Vite.
import { is_object_id } from '../../content/seed_manifest'

/** The row shape both surfaces already hold: the encyclopedia's living /v1 items (items_tab joins the
 * seed slug on each row). Extra fields pass through untouched. */
export interface PetFoodJoinRow {
  slug?: string
  name?: string
  level?: number
}

/**
 * Encyclopedia join: living /v1 item rows -> the food rows a pet detail page lists, level-then-name
 * sorted. A food slug with no live row is silently absent and a row with no slug is never a food —
 * the honest gap, never a fabricated entry.
 */
export function pet_food_rows<T extends PetFoodJoinRow>(food_slugs: readonly string[], items: readonly T[]): T[] {
  const foods = new Set(food_slugs)
  return items
    .filter((item) => !!item.slug && foods.has(item.slug))
    .sort((left, right) => (left.level ?? 0) - (right.level ?? 0) || (left.name ?? '').localeCompare(right.name ?? ''))
}

/**
 * Hover-row join: the food set restricted to slugs the seed receipt actually MINTED (manifest slug ->
 * on-chain template object id). The inventory hover card has no /v1 encyclopedia list in scope, so the
 * receipt (already bundled — content/seed_manifest) is its liveness oracle; an authored-but-unminted
 * food never inflates the count.
 */
export function minted_pet_food_slugs(food_slugs: readonly string[], manifest_items: Record<string, string>): string[] {
  return food_slugs.filter((slug) => is_object_id(manifest_items[slug]))
}
