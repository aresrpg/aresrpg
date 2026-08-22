// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { ListingRow } from '@aresrpg/protocol'

import { item_icon } from '../content/assets.ts'
import { content_catalog, titleize } from '../content/catalog.ts'

export const listing_item = (listing: Readonly<ListingRow>) =>
  listing.item_type ? (content_catalog.items.find(({ item_type }) => item_type === listing.item_type) ?? null) : null

export const listing_name = (listing: Readonly<ListingRow>): string => listing_item(listing)?.name ?? listing.name

export const ListingIcon = ({ listing, size = 34 }: Readonly<{ listing: ListingRow; size?: number }>) => {
  const icon = listing.item_type ? item_icon(listing.item_type) : null
  return (
    <span
      className="grid shrink-0 place-items-center border border-[#c8963c]/20 bg-[#c8963c]/6 text-[9px] font-bold text-[#c8963c] uppercase"
      style={{ width: size, height: size }}
    >
      {icon ? (
        <img alt="" className="size-full object-contain p-0.5" src={icon} />
      ) : listing.kind === 'character' ? (
        listing.classe?.slice(0, 2)
      ) : (
        '◇'
      )}
    </span>
  )
}

export const category_name = (category: string | null): string => (category ? titleize(category) : 'Character')

export const short_address = (address: string | null): string =>
  address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '—'

export const buyer_total = (ask: bigint): bigint => ask + (ask / 10n > 10_000_000n ? ask / 10n : 10_000_000n)

export const legal_lot = (listing: Readonly<Pick<ListingRow, 'category' | 'amount'>>): boolean =>
  !['resource', 'consumable', 'rune'].includes(listing.category ?? '') || [1, 10, 100, 1000].includes(listing.amount)
