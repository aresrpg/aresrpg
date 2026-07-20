// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { item_icon_url } from '@aresrpg/sdk/jobs'

import { cosmetic_icon_of } from '../game/cosmetic_icons.js'
import { icon_asset_class } from '../game/item_classification'

type ShopIconItem = {
  item_template_id: string
  render_name?: string
  category: string
}

type ItemIconResolver = (
  slug: string,
  options?: { hd?: boolean; asset_class?: 'item' | 'cosmetic_icon' }
) => string | null

/** Resolve the authored icon identity and its published class without changing the semantic template id. */
export function shop_item_icon(
  item: ShopIconItem,
  { hd = false, resolve_icon = item_icon_url }: { hd?: boolean; resolve_icon?: ItemIconResolver } = {}
) {
  const cosmetic_icon = cosmetic_icon_of({ slug: item.item_template_id, name: item.render_name })
  const id = cosmetic_icon ?? item.item_template_id
  const asset_class = icon_asset_class(item.category)
  return {
    id,
    image_url: id ? resolve_icon(id, { hd, asset_class }) : null,
  }
}
