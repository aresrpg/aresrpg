// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { item_icon_url, walrus_asset_url } from '@aresrpg/sdk/jobs'

import { cosmetic_icon_of } from '../../game/cosmetic_icons'
import { get_mob_icon_url } from '../../game/data/mobs.js'
import { icon_asset_class } from '../../game/item_classification'

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
  return {
    // `id` is deliberately not a fallback: it is the runtime Sui object address, not an art identity.
    id: cosmetic_identifier ?? item.slug ?? '',
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
