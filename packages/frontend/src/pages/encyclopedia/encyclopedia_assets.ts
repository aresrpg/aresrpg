// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { item_icon_url, walrus_asset_url } from '@aresrpg/sdk/jobs'

import { cosmetic_icon_of } from '../../game/cosmetic_icons'
import { get_mob_icon_url } from '../../game/data/mobs.js'
import { chain_icon_slug, icon_asset_class } from '../../game/item_classification'

type AssetResolver = (asset_class: string, filename: string) => string | null
type ItemIconResolver = (slug: string, options?: { asset_class?: 'item' | 'cosmetic_icon' }) => string | null

interface EncyclopediaItemAssetInput {
  id: string
  slug?: string
  item_type?: string
  name?: string
  display?: { image_url?: string } | null
}

/**
 * Cosmetics are authored with underscore template slugs but several uploaded identifiers use hyphens. The shared
 * cosmetic resolver owns that alias map; this final step also sends those identifiers to their actual quilt class
 * instead of asking the item quilt for a file that only exists in `cosmetic_icon`. That class still depends on the
 * item's category — HAT/CLOAK render through the worn-mannequin `cosmetic_icon` quilt, but TITLE cosmetics (e.g.
 * the veteran scroll) publish under the ordinary `item` quilt, same split `shop_item_icon` uses for shop sales.
 */
export function encyclopedia_item_asset(
  item: EncyclopediaItemAssetInput,
  resolve_icon: ItemIconResolver = item_icon_url
) {
  const cosmetic_identifier = cosmetic_icon_of(item)
  const asset_class = icon_asset_class(item.item_type)
  // Production ships an EMPTY seed catalog (virtual:item_catalog — see vite.config.ts), so `item.slug` is
  // absent for every /v1 row; derive the published icon key from the row's own fields (pet item_type, else the
  // slugified display name) before degrading to '' (the glyph). NOT `item_type` as a raw fallback: for 1342/1840
  // items it is only the generic family word ('chestplate'/'resource' -> items/chestplate.png 404). Chain-truth
  // twin: inventory_item_icon threads the same chain_icon_slug so bag and encyclopedia can never diverge.
  const icon = cosmetic_identifier ?? item.slug ?? chain_icon_slug(item)
  return {
    // The art `id` deliberately never falls back to `item.id` (the runtime Sui object address is not an art
    // identity — that path 404'd every icon); an underivable icon degrades to '' so ItemImage paints the glyph.
    id: icon ?? '',
    image_url: (cosmetic_identifier && resolve_icon(cosmetic_identifier, { asset_class })) || item.display?.image_url,
  }
}

/** Extract only the rendered filename; the old helper's `/sprites/...` fallback is never returned to the browser. */
export function mob_icon_filename(mob: { name?: string; variant?: string }, hd = false): string | null {
  const legacy_candidate = get_mob_icon_url(mob, { hd })
  if (!legacy_candidate) return null
  const filename = legacy_candidate.split('?')[0].split('/').pop()
  return filename || null
}

/** Encyclopedia mob art has one permitted origin: the boot-configured `mob_icon` Walrus quilt. */
export function encyclopedia_mob_icon_url(
  mob: { name?: string; variant?: string },
  hd = false,
  resolve_asset: AssetResolver = walrus_asset_url
): string | null {
  const filename = mob_icon_filename(mob, hd)
  return filename ? resolve_asset('mob_icon', filename) : null
}
