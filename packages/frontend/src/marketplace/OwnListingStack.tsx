// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { MarketListingHoverIcon, MarketOwnListingStack, type MarketOwnListing } from '@aresrpg/ui'
import { X } from 'lucide-react'
import type { ListingRow } from '@aresrpg/protocol'

import { ItemDetailHover } from '../components/ItemSnapshotTooltip.tsx'
import type { CopyText } from '../i18n/copy.ts'
import { useNumbers } from '../i18n/useNumbers.ts'
import { useText } from '../i18n/useText.ts'

import { useMarketCapabilities, useMarketDispatch, useMarketState } from './MarketSource.tsx'
import { listing_art, listing_name, ListingIcon, useCategoryLabel } from './marketplace_model.tsx'

const ListingHoverIcon = ({ listing }: Readonly<{ listing: ListingRow }>) =>
  listing.kind === 'item' ? (
    <ItemDetailHover item={{ ...listing, item_type: listing.item_type ?? '', category: listing.category ?? '' }}>
      <MarketListingHoverIcon label={listing_name(listing)} art={listing_art(listing)} />
    </ItemDetailHover>
  ) : (
    <ListingIcon listing={listing} size={30} />
  )

export const OwnListingStack = ({ listings, text }: Readonly<{ listings: readonly ListingRow[]; text: CopyText }>) => {
  const dispatch_app = useMarketDispatch()
  const { pending } = useMarketState()
  const { withdraw } = useMarketCapabilities()
  const localized_numbers = useNumbers()
  const ui = useText()
  const category_label = useCategoryLabel()
  const views: readonly MarketOwnListing[] = listings.map((listing) => {
    const price = BigInt(listing.price_mist)
    return {
      id: listing.id,
      name: listing_name(listing),
      category: category_label(listing.category),
      level: ui('encyclopedia_page.level_short', { level: listing.level }),
      amount: listing.amount > 1 ? localized_numbers.number(listing.amount) : null,
      price: localized_numbers.sui(price, price % 1_000_000_000n === 0n ? 0 : 2),
      icon: <ListingHoverIcon listing={listing} />,
    }
  })
  return (
    <MarketOwnListingStack
      listings={views}
      stack={listings[0]!.item_type}
      count_title={text('listing_count', { count: listings.length })}
      pending={!!pending}
      withdraw={{ label: text('withdraw'), Icon: X }}
      delist={
        withdraw
          ? (id) => {
              const listing = listings.find((row) => row.id === id)
              if (listing) dispatch_app({ type: 'market/delist_requested', listing })
            }
          : undefined
      }
    />
  )
}
