// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useEffect } from 'react'
import { Button } from '@aresrpg/ui'

import { ModalFrame } from '../components/ModalFrame.tsx'
import { OwnedItemDetail } from '../components/OwnedItemDetail.tsx'
import type { CopyText } from '../i18n/copy.ts'
import { Text } from '../i18n/Text.tsx'
import { useAppStore } from '../store.ts'

import { useMarketCraftSession, useMarketDispatch, useMarketState } from './MarketSource.tsx'
import { item_listing, character_listing, type Selection, type useMarketSell } from './useMarketSell.ts'
import { CategoryName, listing_name, ListingIcon, SuiUnit } from './marketplace_model.tsx'

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
      <div className="aui-market-port market-sale-form min-h-0 overflow-y-auto p-4" data-sale-scroll>
        <div className="rounded-[5px] border border-border bg-surface-high p-4">
          <SelectedCard selected={selected} />
          {selected.kind === 'item' && (
            <LowestPrice item_type={selected.row.item_type} amount={stackable ? lot : 1} sale={sale} text={text} />
          )}
          <label
            htmlFor="market-sale-price"
            className="mt-4 block text-[8px] tracking-[0.18em] text-[#6b7280] uppercase"
          >
            {text('lot_price')}
          </label>
          <div className="mt-1 flex items-center gap-2">
            <input
              id="market-sale-price"
              autoFocus
              className="h-10 min-w-0 flex-1 border border-white/10 bg-bg px-3 text-[12px] tracking-[0.1em] outline-none focus:border-[#c8963c]/60"
              inputMode="decimal"
              onChange={(event) => set_price(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && can_list) list()
              }}
              placeholder="0.00"
              value={price}
            />
            <span className="text-[10px] font-semibold tracking-[0.18em] text-[#67adff]">
              <SuiUnit size={12} />
            </span>
          </div>
          {stackable && (
            <div className="mt-3">
              <p className="mb-1.5 text-[8px] tracking-[0.16em] text-[#6b7280] uppercase">{text('lot_size')}</p>
              <div className="grid grid-cols-4 gap-1">
                {lot_sizes.map((amount) => (
                  <Button
                    aria-pressed={lot === amount}
                    className="text-xs"
                    key={amount}
                    onClick={() => set_lot(amount)}
                    type="button"
                  >
                    ×{amount}
                  </Button>
                ))}
              </div>
            </div>
          )}
          <p className="mt-3 text-[8px] leading-4 text-[#6b7280]">{text('paid_automatically')}</p>
          <div className="mt-4 flex gap-2">
            <button
              className="h-9 flex-1 cursor-pointer border border-[#c8963c]/50 bg-[#c8963c]/10 text-[9px] tracking-[0.15em] text-[#c8963c] uppercase disabled:cursor-not-allowed disabled:opacity-35"
              disabled={!can_list}
              onClick={list}
              type="button"
            >
              {text('list_for_sale')}
            </button>
            <button
              className="h-9 cursor-pointer px-3 text-[9px] text-[#777b86] uppercase"
              onClick={close}
              type="button"
            >
              {text('cancel')}
            </button>
          </div>
        </div>
      </div>
    </ModalFrame>
  )
}

const SelectedCard = ({ selected }: Readonly<{ selected: Selection }>) => {
  const craft_session = useMarketCraftSession()
  const copy = useAppStore((state) => state.copy)
  if (selected.kind === 'item' && copy)
    return (
      <>
        <OwnedItemDetail craft_session={craft_session} item={selected.row} copy={copy} />
        {selected.total_amount > 1 && <p className="mt-2 text-xs text-muted">×{selected.total_amount}</p>}
      </>
    )
  const listing =
    selected.kind === 'item'
      ? { ...item_listing(selected.row, '', 1n), amount: selected.total_amount }
      : character_listing(selected.row, '', 1n)
  return (
    <div className="flex items-center gap-3">
      <ListingIcon listing={listing} size={42} />
      <div className="min-w-0">
        <p className="truncate text-[11px] font-semibold tracking-[0.1em] text-[#e8e4dc] uppercase">
          {listing_name(listing)}
        </p>
        <p className="mt-1 text-[8px] tracking-[0.1em] text-[#6b7280] uppercase">
          <CategoryName category={listing.category} /> ·{' '}
          <Text path="encyclopedia_page.level_short" values={{ level: listing.level }} />
          {listing.amount > 1 ? ` · ×${listing.amount}` : ''}
        </p>
      </div>
    </div>
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
          : `${sale.localized_numbers.sui(BigInt(price), 9)} SUI`
  return (
    <p className="mt-3 flex flex-wrap justify-between gap-2 text-[10px] text-muted" role="status">
      <span>{text('floor_price', { amount })}</span>
      <span className="text-[#67adff]">{message}</span>
    </p>
  )
}
