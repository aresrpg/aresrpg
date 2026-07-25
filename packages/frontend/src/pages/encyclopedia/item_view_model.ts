// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE one projection from a live `/v1/encyclopedia` item row to the shape `ItemDetailView` renders — art
// slug, display category, description, decoded stat ranges and decoded damage lines, all off the SAME row.
//
// It exists because there were TWO homes: the encyclopedia ITEMS tab built this inline while the in-game
// Jobs drawer resolved the same facts through `use_content()` — the bundled seed catalog
// (packages/sdk/src/items.json), which this repo carries as `{}` BY CONSTRUCTION (the content boundary).
// That join could only ever miss, so the recipe detail pane fell back to the recipe row: an icon keyed by
// the Sui OBJECT ID (a guaranteed 404 → the generic glyph), no description, no characteristics — beside a
// list whose rows showed the right art. One home means a crafting surface and the encyclopedia cannot
// disagree about what an item IS.
//
// The seed-catalog arguments stay OPTIONAL and injected (the item_catalog.ts pattern): production ships an
// EMPTY `virtual:item_catalog`, so every field below must already be satisfiable from chain truth alone.
import { item_damages_from_v1, item_stats_from_v1 } from '../../chain/read_findables'
import { item_display_category } from '../../game/item_classification'
import type { RpcEncyclopediaItem } from '../../rpc/views'

import type { CatalogEntry } from './item_catalog'

// A `type`, not an `interface`, ON PURPOSE: consumers that take a row with an index signature (the pet-food
// section's PetFoodItemRow) rely on TypeScript's IMPLICIT index signature, which it grants to object type
// aliases and never to interfaces. Declaring this as an interface makes every such call site red.
export type EncyclopediaItemView = {
  id: string
  name: string
  slug?: string
  desc_key?: string
  description: string
  item_type: string
  category: string
  level: number
  rarity: string
  stats: Record<string, number | [number, number]>
  damages: { element: string; from: number; to: number; damage_type?: string }[]
  display: { image_url?: string } | null
  createdAt: number | undefined
  supply: number
  last_sale_mist: string | null
}

/**
 * One /v1 item row → the detail-view record. `slug`/`catalog_row` are the OPTIONAL seed join (name → slug →
 * authored rarity/itemType, plus the pre-projection damage fallback); omit them and the row still renders
 * every fact the chain carries. An absent field degrades to its honest empty, never to a fabricated value.
 */
export function encyclopedia_item_view(
  item: RpcEncyclopediaItem,
  { slug, catalog_row }: { slug?: string; catalog_row?: CatalogEntry } = {}
): EncyclopediaItemView {
  // /v1 carries a generic item_type; the seed row (when there is one) recovers the asset/description slug.
  const item_type = item.item_type ?? catalog_row?.item_type ?? ''
  return {
    id: item.template_id,
    name: item.name ?? '',
    slug,
    desc_key: slug,
    description: item.description ?? '', // §14 EN description (chain Display, surfaced by /v1); locale via tt
    item_type,
    category: item_display_category({ item_type, category: item.category }),
    level: item.level ?? 0,
    rarity: catalog_row?.rarity ?? '',
    stats: item_stats_from_v1(item.stats) as Record<string, number | [number, number]>,
    // #619 — CHAIN FIRST: the authored damage lines ship on the same /v1 row as the stat ranges
    // (item_damages::DamagesKey projection). The seed catalog stays a fallback for the pre-projection
    // window only; it resolves EMPTY in a corpus-less build, which is what blanked every weapon.
    damages: (item.damages?.length ? item_damages_from_v1(item.damages) : (catalog_row?.damages ?? [])) as {
      element: string
      from: number
      to: number
      damage_type?: string
    }[],
    display: null,
    createdAt: undefined,
    supply: item.supply ?? 0, // live on-chain mint/burn counter (indexer HANDLERS.md "Item supply")
    last_sale_mist: item.last_sale_mist ?? null, // last realised per-unit price (marketcap = supply × this; null = never sold)
  }
}
