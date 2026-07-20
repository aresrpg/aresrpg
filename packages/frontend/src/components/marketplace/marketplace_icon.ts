import { item_icon_url } from '@aresrpg/sdk/jobs'

import { shop_item_icon } from '../../pages/shop_icon'

// THE ONE marketplace icon home. Every marketplace surface (the listing rows, the template detail card,
// the hover tooltip) resolves its icon through the SAME cosmetic-aware path the shop vitrine uses —
// shop_item_icon → cosmetic_icons.js (slug/name → the real uploaded icon slug) + icon_asset_class (the
// wearable `cosmetic_icon` quilt vs the ordinary `item` quilt). Before this, the marketplace fed ItemImage
// the on-chain template id (a 0x object id) with no cosmetic lookup, so every listed cosmetic 404'd to a
// blank/glyph (symptom: "the listed cloak has no image").

// The SDK resolver THROWS on a non-slug key (a 0x object id) by design — a lost template join must never
// silently become `/assets/items/0x….png`. A marketplace row can still carry a raw object id as its slug
// (a cosmetic resolves by NAME instead, so this only bites the non-cosmetic template-miss tail): swallow
// the throw so the caller degrades to the shared category glyph rather than crashing the render.
const safe_item_icon_url = (
  slug: string,
  options?: { hd?: boolean; asset_class?: 'item' | 'cosmetic_icon' }
): string | null => {
  try {
    return item_icon_url(slug, options)
  } catch {
    return null
  }
}

/**
 * Resolve a marketplace item's icon identity + published URL. `slot_category` is the item's own category
 * (e.g. `cloak` / `Cloak` / `hat`) — icon_asset_class reads it to pick the cosmetic vs item quilt; `name`
 * is the RESOLVED display name (cosmetic_icon_of keys off it when the slug is a generic object id).
 */
export function marketplace_item_icon(opts: { slug: string; name: string; slot_category: string; hd?: boolean }): {
  id: string
  image_url: string | null
} {
  return shop_item_icon(
    { item_template_id: opts.slug, render_name: opts.name, category: opts.slot_category },
    { hd: opts.hd ?? false, resolve_icon: safe_item_icon_url }
  )
}
