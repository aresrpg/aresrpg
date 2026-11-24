// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The market page's offer rows and an item's sheet.

import { MarketAskItem, MarketAskRow, MarketEmpty, MarketLotTable } from '@aresrpg/ui'
import type { ListingRow } from '@aresrpg/protocol'
import type { SeedItem } from '@aresrpg/sdk/seed'
import { Store } from 'lucide-react'

import { ItemSummary } from '../components/ItemSummary.tsx'
import { ItemSnapshotTooltip, useItemDetailHover } from '../components/ItemSnapshotTooltip.tsx'
import { ConsumableEffectSection } from '../encyclopedia/ConsumableEffectSection.tsx'
import type { CopyText } from '../i18n/copy.ts'
import { useNumbers } from '../i18n/useNumbers.ts'
import { useText } from '../i18n/useText.ts'
import { dispatch_app, useSiteStore } from '../store.ts'

import { market_page_ready } from './browse_cache.ts'
import { listing_art, listing_name, ListingIcon, offer_purchase, short_address } from './marketplace_model.tsx'

/** What every offer row needs: who looks, what they can pay, the write in flight and whether the page is live. */
export type Offers = Readonly<{
  address: string | null
  balance: bigint | null
  pending: string | null
  ready: boolean
  text: CopyText
}>

export const useOffers = (text: CopyText): Offers => {
  const market = useSiteStore(({ marketplace }) => marketplace)
  const address = useSiteStore(({ session }) => session.wallet?.address ?? null)
  const balance = useSiteStore(({ session }) => session.sui_balance_mist)
  return { address, balance, pending: market.pending, ready: market_page_ready(market), text }
}

export const CharacterOffers = ({ listings, ...offers }: Offers & Readonly<{ listings: readonly ListingRow[] }>) =>
  listings.length === 0 ? (
    <MarketEmpty text={offers.text('no_results')} Icon={Store} />
  ) : (
    listings.map((listing, index) => <AskRow {...offers} index={index} key={listing.id} listing={listing} />)
  )

/** An item's sheet as the market shows it: identity, characteristics and a consumable's effect. */
export const MarketItemSheet = ({
  item,
  note,
  text,
}: Readonly<{ item: SeedItem; note: string | undefined; text: CopyText }>) => {
  const ui = useText()
  return (
    <ItemSummary
      category={item.category}
      damages={item.damages ?? []}
      item_type={item.item_type}
      labels={{
        characteristics: text('characteristics'),
        characteristics_note: note,
        damages: text('damages'),
        level_short: ui('encyclopedia_page.level_short', { level: item.level }),
        range_to: text('range_to'),
      }}
      level={item.level}
      name={item.name}
      stats={item.stats}
    >
      <ConsumableEffectSection
        consumable={item.consumable}
        text={(key, values) => ui(`encyclopedia_page.${key}`, values)}
      />
    </ItemSummary>
  )
}

/** A stackable item's fixed lots, one row each, a dash where no lot of that size is offered. */
export const CheapestLotMarket = ({
  address,
  asks,
  balance,
  pending,
  ready,
  sizes,
  text,
}: Offers & Readonly<{ asks: readonly ListingRow[]; sizes: readonly number[] }>) => {
  const localized_numbers = useNumbers()
  return (
    <MarketLotTable
      labels={{ lot_size: text('lot_size'), price: text('price'), buy: text('buy') }}
      lots={sizes
        .map((size) => ({ size, ask: asks.find(({ amount }) => amount === size) ?? null }))
        .map(({ size, ask }) => {
          const purchase = offer_purchase(ask, address, balance, pending)
          return {
            key: ask?.id ?? `empty_${size}`,
            size,
            total: purchase.total === null ? null : localized_numbers.sui(purchase.total, 2),
            action: purchase.label === null ? '—' : text(purchase.label),
            disabled: !ready || !purchase.enabled,
            buy: () => {
              if (ready && ask) dispatch_app({ type: 'market/buy_requested', listing: ask })
            },
          }
        })}
    />
  )
}

export const AskRow = ({
  address,
  balance,
  index,
  listing,
  pending,
  ready,
  text,
}: Offers & Readonly<{ index: number; listing: ListingRow }>) => {
  const localized_numbers = useNumbers()
  const ui = useText()
  const purchase = offer_purchase(listing, address, balance, pending)
  return (
    <MarketAskRow
      index={index}
      icon={listing.kind === 'item' ? <ItemAskIcon listing={listing} /> : <ListingIcon listing={listing} size={34} />}
      seller={
        listing.kind === 'character'
          ? {
              label: text('seller'),
              name: listing.name,
              level: ui('encyclopedia_page.level_short', { level: listing.level }),
              classe: listing.classe ?? '—',
              address: short_address(listing.seller),
            }
          : null
      }
      price={{ label: text('price'), value: localized_numbers.sui(purchase.total!, 2) }}
      action={{
        label: text(purchase.label!),
        disabled: !ready || !purchase.enabled,
        buy: () => {
          if (ready && purchase.enabled) dispatch_app({ type: 'market/buy_requested', listing })
        },
      }}
    />
  )
}

const ItemAskIcon = ({ listing }: Readonly<{ listing: ListingRow }>) => {
  const copy = useSiteStore((state) => state.copy)
  const item_hover = useItemDetailHover({
    ...listing,
    item_type: listing.item_type ?? '',
    category: listing.category ?? '',
  })
  return (
    <MarketAskItem
      id={listing.id}
      label={listing_name(listing)}
      art={listing_art(listing)}
      open={item_hover.open}
      close={item_hover.close}
      tooltip={copy && <ItemSnapshotTooltip copy={copy} hover={item_hover.hover} />}
    />
  )
}
