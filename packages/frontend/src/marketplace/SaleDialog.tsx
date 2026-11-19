// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useEffect } from 'react'
import { MarketFloor, MarketSaleAmount, MarketSaleForm, MarketSaleSummary } from '@aresrpg/ui'

import { ModalFrame } from '../components/ModalFrame.tsx'
import { OwnedItemDetail } from '../components/OwnedItemDetail.tsx'
import type { CopyText } from '../i18n/copy.ts'
import { useText } from '../i18n/useText.ts'
import { useAppStore } from '../store.ts'

import { useMarketCraftSession, useMarketDispatch, useMarketState } from './MarketSource.tsx'
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
            <LowestPrice item_type={selected.row.item_type} amount={stackable ? lot : 1} sale={sale} text={text} />
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
  const craft_session = useMarketCraftSession()
  const copy = useAppStore((state) => state.copy)
  const ui = useText()
  const category_label = useCategoryLabel()
  if (selected.kind === 'item' && copy)
    return (
      <>
        <OwnedItemDetail craft_session={craft_session} item={selected.row} copy={copy} />
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
  sale,
  text,
}: Readonly<{
  item_type: string
  amount: number
  sale: ReturnType<typeof useMarketSell>
  text: CopyText
}>) => {
  const dispatch = useMarketDispatch()
  const { floor } = useMarketState()
  useEffect(() => {
    dispatch({ type: 'market/floor_selected', item_type })
    return () => dispatch({ type: 'market/floor_selected', item_type: null })
  }, [dispatch, item_type])
  const current = floor?.item_type === item_type ? floor : null
  const price = current?.prices[String(amount)]
  const message =
    !current || current.status === 'loading'
      ? text('floor_loading')
      : current.status === 'unavailable'
        ? text('floor_unavailable')
        : price === undefined
          ? text('floor_empty')
          : `${sale.localized_numbers.decimal(Number(price) / 1_000_000_000, 3)} SUI`
  return <MarketFloor label={text('floor_price', { amount })} message={message} />
}
