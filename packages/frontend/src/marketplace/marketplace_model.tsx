// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { basis_points, marketplace_lot_sizes, marketplace_royalty_bps } from '@aresrpg/immutable'
import type { ListingRow } from '@aresrpg/protocol'
import { ROYALTY_FLOOR_MIST } from '@aresrpg/sdk/marketplace'

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

/** Compact Sui currency mark from the official droplet geometry; color follows its price label. */
export const SuiUnit = ({ size = 10 }: Readonly<{ size?: number }>) => (
  <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[#4a9eff]">
    <svg aria-hidden="true" data-sui-logo height={size} viewBox="0 0 24 24" width={size}>
      <path
        d="M17.636 10.009a7.16 7.16 0 0 1 1.565 4.474 7.2 7.2 0 0 1-1.608 4.53l-.087.106-.023-.135a7 7 0 0 0-.07-.349c-.502-2.21-2.142-4.106-4.84-5.642-1.823-1.034-2.866-2.278-3.14-3.693-.177-.915-.046-1.834.209-2.62.254-.787.631-1.446.953-1.843l1.05-1.284a.46.46 0 0 1 .713 0l5.28 6.456zm1.66-1.283L12.26.123a.336.336 0 0 0-.52 0L4.704 8.726l-.023.029a9.33 9.33 0 0 0-2.07 5.872C2.612 19.803 6.816 24 12 24s9.388-4.197 9.388-9.373a9.32 9.32 0 0 0-2.07-5.871zM6.389 9.981l.63-.77.018.142q.023.17.055.34c.408 2.136 1.862 3.917 4.294 5.297 2.114 1.203 3.345 2.586 3.7 4.103a5.3 5.3 0 0 1 .109 1.801l-.004.034-.03.014A7.2 7.2 0 0 1 12 21.67c-3.976 0-7.2-3.218-7.2-7.188 0-1.705.594-3.27 1.587-4.503z"
        fill="currentColor"
      />
    </svg>
    <span>SUI</span>
  </span>
)

export const buyer_total = (ask: bigint): bigint => {
  const royalty = (ask * BigInt(marketplace_royalty_bps)) / BigInt(basis_points)
  return ask + (royalty > ROYALTY_FLOOR_MIST ? royalty : ROYALTY_FLOOR_MIST)
}

export const legal_lot = (listing: Readonly<Pick<ListingRow, 'category' | 'amount'>>): boolean =>
  !['resource', 'consumable', 'rune'].includes(listing.category ?? '') ||
  marketplace_lot_sizes.includes(listing.amount as (typeof marketplace_lot_sizes)[number])
