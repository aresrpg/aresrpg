// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { basis_points, marketplace_lot_sizes, marketplace_royalty_bps } from '@aresrpg/immutable'
import type { ListingRow } from '@aresrpg/protocol'
import { ROYALTY_FLOOR_MIST } from '@aresrpg/sdk/marketplace'

import { SuiLogo } from '../components/SuiLogo.tsx'
import { useItemCategoryName } from '../i18n/useItemCategoryName.ts'
import { item_icon } from '../content/assets.ts'
import { content_catalog } from '../content/catalog.ts'
import type { CopyText } from '../i18n/copy.ts'
import { format_sui } from '../wallet_amount.ts'

export const listing_item = (listing: Readonly<Pick<ListingRow, 'item_type'>>) =>
  listing.item_type ? (content_catalog.items.find(({ item_type }) => item_type === listing.item_type) ?? null) : null

export const listing_name = (listing: Readonly<Pick<ListingRow, 'name' | 'item_type'>>): string =>
  listing_item(listing)?.name ?? listing.name

export const ListingIcon = ({
  listing,
  size = 34,
}: Readonly<{ listing: Pick<ListingRow, 'item_type' | 'kind' | 'classe'>; size?: number }>) => {
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

export const CategoryName = ({ category }: Readonly<{ category: string | null }>) => {
  const category_name = useItemCategoryName()
  return category ? category_name(category) : 'Character'
}

export const short_address = (address: string | null): string =>
  address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '—'

/** Compact Sui currency mark from the official droplet geometry; color follows its price label. */
export const SuiUnit = ({ size = 10 }: Readonly<{ size?: number }>) => (
  <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[#4a9eff]">
    <SuiLogo size={size} />
    <span>SUI</span>
  </span>
)

export const EpochVolumeBadge = ({
  epoch,
  mist,
  text,
}: Readonly<{
  epoch: string | null
  mist: string | null
  text: CopyText
}>) => (
  <div
    className="flex shrink-0 items-center gap-3 rounded-sm border border-[#4a9eff]/25 bg-[linear-gradient(110deg,rgba(74,158,255,.08),rgba(200,150,60,.06))] px-3 py-2"
    data-marketplace-epoch-volume=""
    title={epoch === null ? undefined : text('volume_epoch', { epoch })}
  >
    <span className="text-[8px] tracking-[0.16em] text-muted uppercase">{text('epoch_volume')}</span>
    <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-gold tabular-nums">
      {mist === null ? '—' : format_sui(BigInt(mist), 2)} <SuiUnit size={12} />
    </span>
  </div>
)

export const buyer_total = (ask: bigint): bigint => {
  const royalty = (ask * BigInt(marketplace_royalty_bps)) / BigInt(basis_points)
  return ask + (royalty > ROYALTY_FLOOR_MIST ? royalty : ROYALTY_FLOOR_MIST)
}

export const legal_lot = (listing: Readonly<Pick<ListingRow, 'category' | 'amount'>>): boolean =>
  !['resource', 'consumable', 'rune'].includes(listing.category ?? '') ||
  marketplace_lot_sizes.includes(listing.amount as (typeof marketplace_lot_sizes)[number])
