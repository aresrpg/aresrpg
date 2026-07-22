// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Store } from 'lucide-react'

import type { MarketplaceListing } from '../../types/chain'
import { format_mist_to_sui } from '../../utils/sui_mist'
import { quality_color } from '../../game/screens/hud/quality'
import { ItemImage } from '../items'

import { visible_marketplace_listings } from './marketplace_model'

export function MyLotsPanel({
  listings,
  address,
  busy,
  on_delist,
  name_of,
  asset_slug_of,
}: {
  listings: MarketplaceListing[]
  address: string | null
  busy: boolean
  on_delist: (listing: MarketplaceListing) => void
  name_of: (template_id: string, fallback: string) => string
  asset_slug_of: (template_id: string) => string
}) {
  const { t } = useTranslation()
  const my_listings = useMemo(
    () =>
      visible_marketplace_listings(listings).filter((listing) => !!address && listing.seller_sui_address === address),
    [address, listings]
  )

  return (
    <div
      data-marketplace-my-lots
      className="flex flex-col w-full lg:w-[360px] lg:min-w-[360px] border-b lg:border-b-0 lg:border-r border-border lg:min-h-0 lg:overflow-hidden"
    >
      <div className="px-4 pt-3 pb-2 shrink-0 flex flex-wrap items-center gap-2">
        <span className="text-[10px] tracking-[0.25em] uppercase font-semibold text-gold">
          {t('marketplace.tab_your_listings')}
        </span>
        {my_listings.length > 0 && <span className="text-gold/60 text-[9px] tabular-nums">({my_listings.length})</span>}
      </div>

      {my_listings.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-8 px-4 text-center text-muted">
          <Store size={18} style={{ opacity: 0.15 }} />
          <span className="text-[9px] tracking-[0.15em] uppercase">{t('marketplace.no_listings')}</span>
        </div>
      ) : (
        <div className="flex flex-col lg:overflow-y-auto">
          {my_listings.map((listing, index) => (
            <div
              key={listing.id}
              className="flex items-center gap-3 px-4 py-2 border-b border-border"
              style={{ background: index % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent' }}
            >
              <ItemImage
                id={asset_slug_of(listing.item.template_id)}
                appearance={listing.item.appearance}
                className="w-7 h-7 shrink-0"
              />
              <div className="flex flex-col min-w-0 flex-1">
                <span
                  className="text-[10px] tracking-[0.1em] uppercase truncate"
                  style={{ color: quality_color(listing.item.rarity) }}
                >
                  {name_of(listing.item.template_id, listing.item.name)}
                </span>
                <span className="text-[8px] tracking-[0.1em] uppercase text-muted/50">
                  {listing.item.category} &middot; Lv. {listing.item.level}
                </span>
              </div>
              {listing.item.quantity > 1 && (
                <span className="text-[9px] text-muted tracking-widest shrink-0">×{listing.item.quantity}</span>
              )}
              <span className="text-[10px] uppercase tracking-[0.15em] text-gold border border-gold/30 px-2 py-0.5 shrink-0 tabular-nums">
                {format_mist_to_sui(BigInt(listing.price_mist), 2)} SUI
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => on_delist(listing)}
                className="btn-outline--danger px-2.5 py-1 text-[9px] shrink-0"
              >
                {t('marketplace.withdraw')}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
