// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { item_icon_url, mob_icon_url } from '@aresrpg/sdk/jobs'

import { cosmetic_icon_of } from '../../game/cosmetic_icons'
import { get_mob_icon_url } from '../../game/data/mobs.js'
import { chain_icon_slug, icon_asset_class } from '../../game/item_classification'

type ItemIconResolver = (slug: string, options?: { asset_class?: 'item' | 'cosmetic_icon' }) => string | null
type MobIconResolver = (filename: string) => string | null

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
  // absent for every /v1 row and the key comes from `item_type` — the authored art slug (chain_icon_slug),
  // unique on every one of the 1854 live rows; the generic family word is `category`, never item_type. A row
  // with no item_type degrades to '' (the glyph), never a guess from the display name. Chain-truth twin:
  // inventory_item_icon threads the same chain_icon_slug so bag and encyclopedia can never diverge.
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

/** Encyclopedia mob art has one permitted origin: the MinIO asset host's `mobs` family. */
export function encyclopedia_mob_icon_url(
  mob: { name?: string; variant?: string },
  hd = false,
  resolve_icon: MobIconResolver = mob_icon_url
): string | null {
  const filename = mob_icon_filename(mob, hd)
  return filename ? resolve_icon(filename) : null
}
