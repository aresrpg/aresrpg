// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { MarketFloor, MarketSaleAmount, MarketSaleForm, MarketSaleSummary } from '@aresrpg/ui'
import { useEffect } from 'react'

import { ModalFrame } from '../components/ModalFrame.tsx'
import { OwnedItemDetail } from '../components/OwnedItemDetail.tsx'
import type { CopyText } from '../i18n/copy.ts'
import { useText } from '../i18n/useText.ts'
import { useNumbers } from '../i18n/useNumbers.ts'
import { dispatch_app, useSiteStore } from '../store.ts'

import { item_listing, character_listing, type Selection, type useMarketSell } from './useMarketSell.ts'
import { listing_art, listing_name, useCategoryLabel } from './marketplace_model.tsx'

export const SaleDialog = ({
  sale,
  selected,
  text,
  close,
}: Readonly<{
  sale: ReturnType<typeof useMarketSell>
  selected: Selection
  text: CopyText
  close: () => void
}>) => {
  const { price, set_price, lot, set_lot, stackable, lot_sizes, can_list, list } = sale
  // The floor prices from the market's listed types: the form observes them while it is open.
  useEffect(() => {
    dispatch_app({ type: 'market/observed', query: { kind: 'types' } })
    return () => dispatch_app({ type: 'market/observed', query: null })
  }, [])
  return (
    <ModalFrame label={text('list_for_sale')} close={close} close_label={text('cancel')} max_width="max-w-lg">
      <MarketSaleForm
        labels={{
          lot_price: text('lot_price'),
          lot_size: text('lot_size'),
          paid_automatically: text('paid_automatically'),
          list: text('list_for_sale'),
          cancel: text('cancel'),
        }}
        summary={<SelectedCard selected={selected} />}
        floor={
          selected.kind === 'item' && (
            <LowestPrice item_type={selected.row.item_type} amount={stackable ? lot : 1} text={text} />
          )
        }
        price={{ value: price, change: set_price }}
        lots={stackable ? { sizes: lot_sizes, value: lot, select: set_lot } : null}
        can_list={can_list}
        list={list}
        close={close}
      />
    </ModalFrame>
  )
}

const SelectedCard = ({ selected }: Readonly<{ selected: Selection }>) => {
  const copy = useSiteStore((state) => state.copy)
  const ui = useText()
  const category_label = useCategoryLabel()
  if (selected.kind === 'item' && copy)
    return (
      <>
        <OwnedItemDetail item={selected.row} copy={copy} />
        {selected.total_amount > 1 && <MarketSaleAmount amount={selected.total_amount} />}
      </>
    )
  const listing =
    selected.kind === 'item'
      ? { ...item_listing(selected.row, '', 1n), amount: selected.total_amount }
      : character_listing(selected.row, '', 1n)
  return (
    <MarketSaleSummary
      art={listing_art(listing)}
      name={listing_name(listing)}
      category={category_label(listing.category)}
      level={ui('encyclopedia_page.level_short', { level: listing.level })}
      amount={listing.amount > 1 ? ` · ×${listing.amount}` : ''}
    />
  )
}

const LowestPrice = ({
  item_type,
  amount,
  text,
}: Readonly<{
  item_type: string
  amount: number
  text: CopyText
}>) => {
  // The cheapest public lot of this size, from the market's one list of listed types.
  const types = useSiteStore(({ marketplace }) => marketplace.types)
  const numbers = useNumbers()
  const price = types?.find((row) => row.item_type === item_type)?.quote.lots[String(amount)]
  const message =
    types === null
      ? text('floor_loading')
      : price === undefined
        ? text('floor_empty')
        : `${numbers.decimal(Number(price) / 1_000_000_000, 3)} SUI`
  return <MarketFloor label={text('floor_price', { amount })} message={message} />
}
