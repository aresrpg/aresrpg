// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { marketplace_lot_sizes } from '@aresrpg/immutable'
import type { ListingRow } from '@aresrpg/protocol'
import { MarketListingIcon, MarketVolume, type MarketArt } from '@aresrpg/ui'

import { useLocale } from '../i18n/LocaleScope.tsx'
import { useNumbers } from '../i18n/useNumbers.ts'
import { useText } from '../i18n/useText.ts'
import { useItemCategoryName } from '../i18n/useItemCategoryName.ts'
import { item_icon } from '../content/assets.ts'
import { items_by_type } from '../content/items.ts'
import type { CopyText } from '../i18n/copy.ts'

import { buyer_total, market_needs_funding } from './price.ts'

/** The content's name of a listed item, or the name the listing carries. */
export const listing_name = (listing: Readonly<Pick<ListingRow, 'name' | 'item_type'>>): string =>
  (listing.item_type ? items_by_type[listing.item_type]?.name : undefined) ?? listing.name

/** The listing art: the item picture, a character's class initials, or a neutral mark. */
export const listing_art = (listing: Readonly<Pick<ListingRow, 'item_type' | 'kind' | 'classe'>>): MarketArt => ({
  icon: listing.item_type ? item_icon(listing.item_type) : null,
  fallback: listing.kind === 'character' ? listing.classe?.slice(0, 2) : '◇',
})

export const ListingIcon = ({
  listing,
  size = 34,
}: Readonly<{ listing: Pick<ListingRow, 'item_type' | 'kind' | 'classe'>; size?: number }>) => (
  <MarketListingIcon art={listing_art(listing)} size={size} />
)

/** A listing's category name; character listings have none. */
export const useCategoryLabel = () => {
  const text = useText()
  const category_name = useItemCategoryName()
  return (category: string | null): string => (category ? category_name(category) : text('ui.character'))
}

export const CategoryName = ({ category }: Readonly<{ category: string | null }>) => useCategoryLabel()(category)

export const short_address = (address: string | null): string =>
  address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '—'

export const MarketVolumeBadge = ({
  window,
  mist,
  partial = false,
  text,
}: Readonly<{
  window: '24h' | '30d'
  mist: string | null
  partial?: boolean
  text: CopyText
}>) => {
  const locale = useLocale()
  const numbers = useNumbers()
  const period = { '24h': { value: 24, unit: 'hour' }, '30d': { value: 30, unit: 'day' } }[window]
  const duration = new Intl.NumberFormat(locale, { style: 'unit', unit: period.unit, unitDisplay: 'short' }).format(
    period.value
  )
  return (
    <MarketVolume
      window={window}
      title={text(mist === null ? 'volume_unavailable' : partial ? 'volume_partial' : 'volume_window', {
        window: duration,
      })}
      partial={mist !== null && partial}
      label={text(`volume_${window}`)}
      value={mist === null ? '—' : `${partial ? '≥ ' : ''}${numbers.sui(BigInt(mist), 2)}`}
    />
  )
}

export const legal_lot = (listing: Readonly<Pick<ListingRow, 'category' | 'amount'>>): boolean =>
  !['resource', 'consumable', 'rune'].includes(listing.category ?? '') ||
  marketplace_lot_sizes.includes(listing.amount as (typeof marketplace_lot_sizes)[number])

/** One purchase affordance for quantity rows and individual equipment/character offers. */
export const offer_purchase = (
  listing: Readonly<ListingRow> | null,
  address: string | null,
  balance: bigint | null,
  pending: string | null
) => {
  if (!listing) return { total: null, label: null, enabled: false }
  const total = buyer_total(BigInt(listing.price_mist))
  const label =
    listing.seller === address ? 'yours' : market_needs_funding(listing.price_mist, balance) ? 'add_funds' : 'buy'
  return { total, label, enabled: label !== 'yours' && pending === null }
}
