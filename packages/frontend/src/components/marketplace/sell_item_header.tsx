// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ReactNode } from 'react'

import { ItemImage } from '../items'

import { marketplace_item_icon, marketplace_listing_icon_slug } from './marketplace_icon'

// The SELL card's item header — the icon + name block the stackable-lot card and the ordinary item card
// share. #1296: the icon derives from THE ONE marketplace slug chain (marketplace_listing_icon_slug), never
// a local re-implementation. sell_panel used to read that chain backwards inline — `template_id ?? slug`,
// the nullable/unresolvable leg BEFORE the always-present item_type slug — so every item whose template row
// is missing from templates_item (most non-cosmetic owned items) fed ItemImage a raw 0x object id and drew
// the placeholder cube on the card while the inventory grid beside it showed the real icon.
export function SellItemHeader({
  item,
  catalog_name,
  catalog_slug,
  display_name,
  subtitle,
}: {
  item: { slug?: string | null; template_id?: string | null; category: string }
  catalog_name?: string
  catalog_slug?: string | null
  display_name: string
  subtitle: ReactNode
}) {
  const icon = marketplace_item_icon({
    slug: marketplace_listing_icon_slug(item, catalog_slug),
    name: catalog_name || display_name,
    slot_category: item.category,
  })
  return (
    <div className="flex items-center gap-3">
      <ItemImage
        id={icon.id}
        image_url={icon.image_url ?? undefined}
        category={item.category}
        className="w-10 h-10 shrink-0"
      />
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-text text-[11px] tracking-[0.12em] uppercase font-semibold truncate">{display_name}</span>
        <span className="text-muted text-[8px] tracking-[0.1em] uppercase">{subtitle}</span>
      </div>
    </div>
  )
}
