// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Package, Store, Tag } from 'lucide-react'

import { ItemDetailContext } from '../components/ItemDetailContext.ts'
import { ItemDetailHover } from '../components/ItemSnapshotTooltip.tsx'
import { OwnedItemDetail } from '../components/OwnedItemDetail.tsx'
import { item_icon } from '../content/assets.ts'
import { content_catalog } from '../content/catalog.ts'
import type { CopyText } from '../i18n/copy.ts'
import { Text } from '../i18n/Text.tsx'
import { useAppStore } from '../store.ts'

import { useMarketDispatch, useMarketCraftSession } from './MarketSource.tsx'
import { useMarketSell, item_listing, character_listing, type Selection } from './useMarketSell.ts'
import { CategoryName, listing_name, ListingIcon, SuiUnit } from './marketplace_model.tsx'

export const SellPanel = ({ text }: Readonly<{ text: CopyText }>) => {
  const dispatch_app = useMarketDispatch()
  const {
    localized_numbers,
    ui,
    market,
    set_selected_key,
    price,
    set_price,
    lot,
    set_lot,
    inventory,
    items,
    characters,
    selected,
    stackable,
    lot_sizes,
    can_list,
    choose,
    list,
  } = useMarketSell()

  return (
    <ItemDetailContext.Provider value="summary">
      <div className="market-sell flex min-h-0 flex-1 overflow-hidden bg-bg">
        <section className="market-own-listings flex min-h-0 w-[360px] shrink-0 flex-col border-r border-border bg-surface">
          <PanelTitle>
            {text('your_listings')} {market.own_listings.length ? `(${market.own_listings.length})` : ''}
          </PanelTitle>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {market.own_listings.length === 0 ? (
              <PanelEmpty icon="store" text={text('no_listings')} />
            ) : (
              market.own_listings.map((listing, index) => (
                <div
                  className={`flex items-center gap-3 border-b border-white/7 px-4 py-2 ${index % 2 ? 'bg-white/[0.018]' : ''}`}
                  key={listing.id}
                >
                  {listing.kind === 'item' ? (
                    <ItemDetailHover
                      item={{ ...listing, item_type: listing.item_type ?? '', category: listing.category ?? '' }}
                    >
                      <button type="button" className="cursor-help" aria-label={listing_name(listing)}>
                        <ListingIcon listing={listing} size={30} />
                      </button>
                    </ItemDetailHover>
                  ) : (
                    <ListingIcon listing={listing} size={30} />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[10px] text-[#e8e4dc] uppercase">{listing_name(listing)}</p>
                    <p className="text-[8px] text-[#6b7280] uppercase">
                      <CategoryName category={listing.category} /> ·{' '}
                      <Text path="encyclopedia_page.level_short" values={{ level: listing.level }} />
                      {listing.amount > 1 ? ` · ×${listing.amount}` : ''}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-[9px] tabular-nums text-[#c8963c]">
                    {localized_numbers.sui(BigInt(listing.price_mist), 2)} <SuiUnit />
                  </span>
                  <button
                    className="cursor-pointer border border-[#ff5a8b]/35 px-2 py-1 text-[8px] tracking-[0.12em] text-[#ff6fa8] uppercase disabled:opacity-40"
                    disabled={!!market.pending}
                    onClick={() => dispatch_app({ type: 'market/delist_requested', listing })}
                    type="button"
                  >
                    {text('withdraw')}
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="market-sale-form flex w-[340px] shrink-0 flex-col border-r border-border bg-surface">
          <PanelTitle>{text('list_for_sale')}</PanelTitle>
          {!selected ? (
            <PanelEmpty icon="tag" text={text('select_to_list')} />
          ) : (
            <div className="min-h-0 overflow-y-auto px-4 pb-4" data-sale-scroll>
              <div className="rounded-[5px] border border-border bg-surface-high p-4">
                <SelectedCard selected={selected} />
                <label className="mt-4 block text-[8px] tracking-[0.18em] text-[#6b7280] uppercase">
                  {text('price')}
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <input
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
                        <button
                          className={`h-8 cursor-pointer border text-[9px] ${lot === amount ? 'border-[#c8963c] bg-[#c8963c]/10 text-[#c8963c]' : 'border-white/10 text-[#777b86]'}`}
                          key={amount}
                          onClick={() => set_lot(amount)}
                          type="button"
                        >
                          ×{amount}
                        </button>
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
                    onClick={() => set_selected_key(null)}
                    type="button"
                  >
                    {text('cancel')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="market-inventory flex min-w-0 flex-1 flex-col bg-surface-high">
          <PanelTitle>{text('inventory')}</PanelTitle>
          <div className="min-h-0 overflow-y-auto p-4">
            {characters.length > 0 && (
              <>
                <p className="mb-2 text-[8px] tracking-[0.18em] text-[#6b7280] uppercase">{text('characters')}</p>
                <div className="mb-5 grid grid-cols-[repeat(auto-fill,52px)] gap-1">
                  {characters.map((row) => (
                    <button
                      className={`grid h-[52px] cursor-pointer place-items-center border text-[8px] uppercase ${selected?.kind === 'character' && selected.row.id === row.id ? 'border-[#c8963c] bg-[#c8963c]/10 text-[#c8963c]' : 'border-white/10 bg-white/2 text-[#9da0a9]'}`}
                      key={row.id}
                      onClick={() => choose({ kind: 'character', row })}
                      title={`${row.name} · ${ui('encyclopedia_page.level_short', { level: row.level })}`}
                      type="button"
                    >
                      <span>{row.classe.slice(0, 2)}</span>
                      <small>
                        <Text path="encyclopedia_page.level_short" values={{ level: row.level }} />
                      </small>
                    </button>
                  ))}
                </div>
              </>
            )}
            <p className="mb-2 text-[8px] tracking-[0.18em] text-[#6b7280] uppercase">{text('items')}</p>
            {items.length === 0 && characters.length === 0 ? (
              <PanelEmpty icon="package" text={text('empty_inventory')} />
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,52px)] gap-1">
                {items.map((selection) => {
                  const { row, total_amount } = selection
                  const icon = item_icon(row.item_type)
                  const item = content_catalog.item(row.item_type)?.item
                  const active = selected?.kind === 'item' && selected.row.id === row.id
                  return (
                    <button
                      className={`relative grid h-[52px] cursor-pointer place-items-center border ${active ? 'border-[#c8963c] bg-[#c8963c]/10' : 'border-white/10 bg-white/2 hover:border-[#c8963c]/40'}`}
                      data-marketplace-owned-item={row.id}
                      key={row.id}
                      onClick={() => choose(selection)}
                      title={`${item?.name ?? row.name} · ${ui('encyclopedia_page.level_short', { level: row.level })}`}
                      type="button"
                    >
                      {icon ? (
                        <img alt="" className="size-10 object-contain" src={icon} />
                      ) : (
                        <span className="text-[#c8963c]">◇</span>
                      )}
                      {total_amount > 1 && (
                        <small className="absolute right-1 bottom-0.5 text-[8px] text-[#e8e4dc]">×{total_amount}</small>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    </ItemDetailContext.Provider>
  )
}

const PanelTitle = ({ children }: Readonly<{ children: React.ReactNode }>) => (
  <h3 className="shrink-0 border-b border-border bg-surface-high px-4 py-3 text-[10px] font-semibold tracking-[0.24em] text-[#c8963c] uppercase">
    {children}
  </h3>
)
const PanelEmpty = ({ icon, text }: Readonly<{ icon: 'store' | 'tag' | 'package'; text: string }>) => {
  const Icon = icon === 'store' ? Store : icon === 'tag' ? Tag : Package
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center text-[9px] tracking-[0.15em] text-[#6b7280] uppercase">
      <Icon size={18} className="opacity-20" />
      {text}
    </div>
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
