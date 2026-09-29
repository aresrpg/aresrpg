// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Button } from '@aresrpg/ui'
import { class_names, item_is_stackable, marketplace_lot_sizes, type ItemCategory } from '@aresrpg/immutable'
import { has_market_page, type ListingRow, type MarketTypeCounts } from '@aresrpg/protocol'
import { Search, Store } from 'lucide-react'

import { ItemDetailContext } from '../components/ItemDetailContext.ts'
import { ItemDetailView } from '../components/ItemDetailView.tsx'
import { ItemSnapshotTooltip, useItemDetailHover } from '../components/ItemSnapshotTooltip.tsx'
import type { CopyText } from '../i18n/copy.ts'
import { Text } from '../i18n/Text.tsx'
import { useNumbers } from '../i18n/useNumbers.ts'
import { market_categories, MARKET_GROUPS, type MarketGroup } from '../modules/marketplace.ts'
import { useAppStore } from '../store.ts'

import { useMarketDispatch, useMarketCraftSession } from './MarketSource.tsx'
import { useMarketBrowse } from './useMarketBrowse.ts'
import { MarketCapitalization } from './MarketCapitalization.tsx'
import {
  buyer_total,
  CategoryName,
  listing_name,
  ListingIcon,
  offer_purchase,
  short_address,
  SuiUnit,
} from './marketplace_model.tsx'
import { PriceHistoryChart } from './PriceHistoryChart.tsx'

const group_key = (group: MarketGroup): string => `group_${group.toLowerCase()}`

const TypeCount = ({
  counts,
  categories,
}: Readonly<{ counts: MarketTypeCounts | null; categories: readonly ItemCategory[] }>) => {
  const numbers = useNumbers()
  if (!counts || !categories.length) return null
  return (
    <span className="shrink-0 text-[9px] text-muted tabular-nums" data-marketplace-type-count>
      {numbers.number(categories.reduce((total, category) => total + (counts[category] ?? 0), 0))}
    </span>
  )
}

export const BrowsePanel = ({ text }: Readonly<{ text: CopyText }>) => {
  const dispatch_app = useMarketDispatch()
  const craft_session = useMarketCraftSession()
  const {
    localized_numbers,
    ui,
    characteristics_notes,
    market,
    address,
    balance,
    search,
    set_search,
    minimum_level,
    set_minimum_level,
    maximum_level,
    set_maximum_level,
    character_class,
    set_character_class,
    listings,
    ready,
    character_listings,
    subcategories,
    active_subcategory,
    types,
    active_type,
    selected,
    asks,
    item,
    select_group,
  } = useMarketBrowse()

  return (
    <ItemDetailContext.Provider value="summary">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="market-browse flex min-h-0 flex-1 overflow-hidden bg-bg">
          <aside className="market-groups flex w-36 shrink-0 flex-col border-r border-border bg-surface-low">
            <h3 className="border-b border-white/10 px-4 py-3 text-[10px] font-semibold tracking-[0.25em] text-[#c8963c] uppercase">
              {text('browse')}
            </h3>
            <nav aria-label={text('browse')} className="min-h-0 overflow-y-auto" data-marketplace-general-categories>
              {MARKET_GROUPS.map((group) => (
                <Button
                  className="market-filter"
                  aria-pressed={market.group === group}
                  key={group}
                  onClick={() => select_group(group)}
                  type="button"
                >
                  <span>{text(group_key(group))}</span>
                  <TypeCount counts={market.type_counts} categories={market_categories(group)} />
                </Button>
              ))}
            </nav>
          </aside>

          {market.group === 'CHARACTERS' ? (
            <section className="market-characters flex min-h-0 flex-1 flex-col">
              <div className="flex shrink-0 flex-wrap items-end gap-5 border-b border-border bg-surface-high px-4 py-3">
                <label className="flex flex-col gap-1 text-[8px] tracking-[0.15em] text-[#6b7280] uppercase">
                  {text('level')}
                  <span className="flex items-center gap-1.5">
                    <input
                      className="h-8 w-16 border border-white/10 bg-bg px-2 text-center text-[9px] outline-none"
                      inputMode="numeric"
                      onChange={(event) => set_minimum_level(event.target.value.replace(/\D/g, ''))}
                      placeholder={ui('encyclopedia_page.minimum')}
                      value={minimum_level}
                    />
                    <span>–</span>
                    <input
                      className="h-8 w-16 border border-white/10 bg-bg px-2 text-center text-[9px] outline-none"
                      inputMode="numeric"
                      onChange={(event) => set_maximum_level(event.target.value.replace(/\D/g, ''))}
                      placeholder={ui('encyclopedia_page.maximum')}
                      value={maximum_level}
                    />
                  </span>
                </label>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-[8px] tracking-[0.15em] text-[#6b7280] uppercase">{text('class')}</span>
                  <div className="flex flex-wrap gap-1">
                    {class_names.map((classe) => (
                      <button
                        className={`h-7 cursor-pointer border px-2 text-[8px] tracking-[0.1em] uppercase ${character_class === classe ? 'border-[#c8963c] bg-[#c8963c]/10 text-[#c8963c]' : 'border-white/10 text-[#777b86]'}`}
                        key={classe}
                        onClick={() => set_character_class((current) => (current === classe ? null : classe))}
                        type="button"
                      >
                        {classe}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {character_listings.length === 0 ? (
                  <Empty text={text('no_results')} />
                ) : (
                  character_listings.map((listing, index) => (
                    <AskRow
                      address={address}
                      balance={balance}
                      index={index}
                      key={listing.id}
                      listing={listing}
                      pending={market.pending}
                      ready={ready}
                      text={text}
                    />
                  ))
                )}
              </div>
            </section>
          ) : (
            <>
              {subcategories.length > 1 && (
                <nav
                  className="market-subcategories w-40 shrink-0 overflow-y-auto border-r border-border bg-surface py-1"
                  data-marketplace-item-types
                >
                  {subcategories.map((category) => (
                    <Button
                      className="market-filter"
                      aria-pressed={category === active_subcategory}
                      key={category}
                      onClick={() => {
                        dispatch_app({ type: 'market/group_selected', group: market.group, category })
                      }}
                      type="button"
                    >
                      <span className="flex items-center justify-between gap-3">
                        <span>
                          <CategoryName category={category} />
                        </span>
                        <TypeCount counts={market.type_counts} categories={[category]} />
                      </span>
                    </Button>
                  ))}
                </nav>
              )}
              <section
                className="market-templates flex w-56 shrink-0 flex-col border-r border-border bg-surface"
                data-marketplace-item-type-column
              >
                <label className="flex items-center gap-2 border-b border-border bg-surface-high p-2">
                  <Search size={12} className="text-[#555b66]" />
                  <input
                    className="h-8 min-w-0 flex-1 border border-white/14 bg-bg px-2 text-[9px] text-[#e3dfd7] outline-none placeholder:text-[#555b66] focus:border-[#4a9eff]/60"
                    onChange={(event) => set_search(event.target.value)}
                    placeholder={text('search')}
                    value={search}
                  />
                </label>
                <div className="min-h-0 overflow-y-auto" data-marketplace-template-options>
                  {types.map(({ item_type, name }) => (
                    <Button
                      className="market-template"
                      aria-pressed={item_type === active_type}
                      key={item_type}
                      onClick={() => {
                        if (active_subcategory)
                          dispatch_app({
                            type: 'market/group_selected',
                            group: market.group,
                            category: active_subcategory,
                            item_type,
                          })
                      }}
                      type="button"
                    >
                      <ListingIcon listing={{ kind: 'item', item_type }} size={42} />
                      <span className="min-w-0 flex-1 truncate text-[10px] text-[#d8d4cc] uppercase">{name}</span>
                    </Button>
                  ))}
                </div>
              </section>
              <section className="market-detail flex min-h-0 min-w-0 flex-1 flex-col">
                {!selected ? (
                  <Empty text={text('select_item')} />
                ) : (
                  <div className="flex min-h-0 flex-1 flex-col">
                    <div className="flex shrink-0 items-center gap-3 border-b border-border bg-surface-raised px-4 py-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.16)]">
                      <ListingIcon listing={{ kind: 'item', item_type: active_type }} size={28} />
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-[10px] font-semibold tracking-[0.2em] text-[#e8e4dc] uppercase">
                          {selected.name}
                        </h3>
                      </div>
                      {selected.level > 0 && (
                        <span className="text-[8px] text-[#6b7280]">
                          <Text path="encyclopedia_page.level_short" values={{ level: selected.level }} />
                        </span>
                      )}
                      {asks[0] && (
                        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold tabular-nums text-[#f0c66c]">
                          {localized_numbers.sui(buyer_total(BigInt(asks[0].price_mist)), 2)} <SuiUnit />
                        </span>
                      )}
                    </div>
                    <div className="market-detail-body min-h-0 flex-1 overflow-y-auto bg-surface-high p-4">
                      <div className="flex min-h-full flex-col gap-4">
                        {item && (
                          <div className="market-item-summary">
                            <div className="min-w-0 flex-1 basis-64">
                              <ItemDetailView
                                craft_session={craft_session}
                                category={item.category}
                                damages={item.damages ?? []}
                                item_type={item.item_type}
                                labels={{
                                  characteristics: text('characteristics'),
                                  characteristics_note: characteristics_notes[item.category],
                                  damages: text('damages'),
                                  level_short: ui('encyclopedia_page.level_short', { level: item.level }),
                                  range_to: text('range_to'),
                                }}
                                level={item.level}
                                name={item.name}
                                stats={item.stats}
                              />
                            </div>
                            <MarketCapitalization item_type={item.item_type} text={text} />
                          </div>
                        )}
                        {item_is_stackable(selected.category ?? '') ? (
                          <div className="market-item-columns">
                            <div className="min-w-0" data-marketplace-listings aria-busy={!ready}>
                              <CheapestLotMarket
                                address={address}
                                asks={asks}
                                balance={balance}
                                pending={market.pending}
                                ready={ready}
                                sizes={marketplace_lot_sizes}
                                text={text}
                              />
                            </div>
                            <PriceHistoryChart item_type={active_type!} key={active_type} text={text} />
                          </div>
                        ) : (
                          <div className="mx-auto w-full max-w-[560px]" data-marketplace-listings aria-busy={!ready}>
                            {asks.map((listing, index) => (
                              <AskRow
                                address={address}
                                balance={balance}
                                index={index}
                                key={listing.id}
                                listing={listing}
                                pending={market.pending}
                                ready={ready}
                                text={text}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
        {has_market_page(market.observation) && (market.page_cursors.length > 0 || market.next_cursor) && (
          <nav
            className="flex shrink-0 justify-end gap-2 border-t border-border bg-surface px-4 py-2"
            aria-label={text('browse')}
          >
            <button
              type="button"
              className="cursor-pointer border border-gold/30 px-3 py-2 text-[9px] tracking-widest text-gold uppercase disabled:opacity-30"
              disabled={!market.page_cursors.length}
              onClick={() => dispatch_app({ type: 'market/page_requested', direction: 'previous' })}
            >
              {text('previous_page')}
            </button>
            <button
              type="button"
              className="cursor-pointer border border-gold/30 px-3 py-2 text-[9px] tracking-widest text-gold uppercase disabled:opacity-30"
              disabled={!market.next_cursor}
              onClick={() => dispatch_app({ type: 'market/page_requested', direction: 'next' })}
            >
              {text('next_page')}
            </button>
          </nav>
        )}
      </div>
    </ItemDetailContext.Provider>
  )
}

const Empty = ({ text }: Readonly<{ text: string }>) => (
  <div className="grid h-full place-items-center">
    <span className="flex items-center gap-2 text-[9px] tracking-[0.18em] text-[#6b7280] uppercase">
      <Store size={16} className="opacity-20" />
      {text}
    </span>
  </div>
)

const CheapestLotMarket = ({
  address,
  asks,
  balance,
  pending,
  ready,
  sizes,
  text,
}: Readonly<{
  address: string | null
  asks: readonly ListingRow[]
  balance: bigint | null
  pending: string | null
  ready: boolean
  sizes: readonly number[]
  text: CopyText
}>) => {
  const dispatch_app = useMarketDispatch()
  const localized_numbers = useNumbers()
  return (
    <div
      className="mx-auto w-full max-w-[560px] overflow-hidden rounded-[5px] border border-border bg-surface shadow-[0_10px_28px_rgba(0,0,0,0.16)]"
      data-marketplace-lot-market
    >
      <div className="market-lot-row grid grid-cols-[72px_minmax(100px,180px)_minmax(80px,110px)] items-center justify-center gap-4 border-b border-border bg-surface-high px-4 py-2 text-[8px] tracking-[0.16em] text-[#6d7382] uppercase">
        <span>{text('lot_size')}</span>
        <span>{text('price')}</span>
        <span className="text-center">{text('buy')}</span>
      </div>
      <div className="divide-y divide-white/7">
        {sizes
          .map((size) => ({ size, ask: asks.find(({ amount }) => amount === size) ?? null }))
          .map(({ size, ask }, index) => {
            const purchase = offer_purchase(ask, address, balance, pending)
            const { total } = purchase
            return (
              <div
                className={`market-lot-row grid min-h-18 min-w-0 grid-cols-[72px_minmax(100px,180px)_minmax(80px,110px)] items-center justify-center gap-4 px-4 py-2 ${index % 2 ? 'bg-white/[0.018]' : ''}`}
                data-marketplace-cheapest-lot={size}
                data-marketplace-listing-row
                key={ask?.id ?? `empty_${size}`}
              >
                <div className="flex min-w-0 items-center justify-center">
                  <span className="text-[16px] font-semibold tracking-[0.08em] text-[#efbd45]">×{size}</span>
                </div>
                <div className="min-w-0 overflow-hidden">
                  <span
                    className={`block truncate whitespace-nowrap text-[15px] font-semibold tabular-nums ${ask ? 'text-[#e8e4dc]' : 'text-[#5f636d]'}`}
                  >
                    {total === null ? (
                      '—'
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        {localized_numbers.sui(total, 2)} <SuiUnit size={12} />
                      </span>
                    )}
                  </span>
                </div>
                <button
                  className="h-10 w-full min-w-0 cursor-pointer overflow-hidden border border-[#c8963c]/45 bg-[#c8963c]/8 px-3 text-ellipsis whitespace-nowrap text-[8px] font-semibold tracking-[0.13em] text-[#efbd45] uppercase hover:bg-[#c8963c]/13 disabled:cursor-not-allowed disabled:border-white/7 disabled:bg-transparent disabled:text-[#555b66]"
                  disabled={!ready || !purchase.enabled}
                  onClick={() => {
                    if (ready && ask) dispatch_app({ type: 'market/buy_requested', listing: ask })
                  }}
                  type="button"
                >
                  {purchase.label === null ? '—' : text(purchase.label)}
                </button>
              </div>
            )
          })}
      </div>
    </div>
  )
}

const AskRow = ({
  address,
  balance,
  index,
  listing,
  pending,
  ready,
  text,
}: Readonly<{
  address: string | null
  balance: bigint | null
  index: number
  listing: ListingRow
  pending: string | null
  ready: boolean
  text: CopyText
}>) => {
  const dispatch_app = useMarketDispatch()
  const localized_numbers = useNumbers()
  const purchase = offer_purchase(listing, address, balance, pending)

  return (
    <div
      className={`market-ask flex min-w-0 items-center justify-center gap-4 border-b border-white/7 px-3 py-2 transition-colors ${index % 2 ? 'bg-white/[0.018]' : ''}`}
      data-marketplace-listing-row
    >
      {listing.kind === 'item' ? <ItemAskIcon listing={listing} /> : <ListingIcon listing={listing} size={34} />}
      {listing.kind === 'character' && (
        <div className="flex min-w-0 flex-[1_1_130px] flex-col">
          <span className="text-[7px] tracking-[0.16em] text-[#555b66] uppercase">{text('seller')}</span>
          <span className="truncate text-[9px] tracking-[0.08em] text-[#a2a6ae]">{listing.name}</span>
          <span className="truncate text-[7px] text-[#646a75]">
            <Text path="encyclopedia_page.level_short" values={{ level: listing.level }} /> · {listing.classe ?? '—'} ·{' '}
            {short_address(listing.seller)}
          </span>
        </div>
      )}
      <div className="flex w-28 min-w-0 shrink flex-col items-end overflow-hidden">
        <span className="text-[7px] tracking-[0.16em] text-[#555b66] uppercase">{text('price')}</span>
        <span className="max-w-full truncate whitespace-nowrap text-[10px] tabular-nums text-[#c8963c]">
          {localized_numbers.sui(purchase.total!, 2)} <SuiUnit />
        </span>
      </div>
      <button
        className="h-8 w-24 min-w-0 shrink cursor-pointer overflow-hidden border border-[#c8963c]/35 px-2 text-ellipsis whitespace-nowrap text-[8px] tracking-[0.12em] text-[#c8963c] uppercase disabled:cursor-not-allowed disabled:opacity-35"
        disabled={!ready || !purchase.enabled}
        onClick={(event) => {
          event.stopPropagation()
          if (ready && purchase.enabled) dispatch_app({ type: 'market/buy_requested', listing })
        }}
        type="button"
      >
        {text(purchase.label!)}
      </button>
    </div>
  )
}

const ItemAskIcon = ({ listing }: Readonly<{ listing: ListingRow }>) => {
  const copy = useAppStore((state) => state.copy)
  const item_hover = useItemDetailHover({
    ...listing,
    item_type: listing.item_type ?? '',
    category: listing.category ?? '',
  })
  return (
    <>
      <button
        aria-label={listing_name(listing)}
        className="shrink-0 cursor-help focus-visible:outline focus-visible:outline-gold"
        data-marketplace-item={listing.id}
        onBlur={item_hover.close}
        onFocus={(event) => item_hover.open(event.currentTarget)}
        onMouseEnter={(event) => item_hover.open(event.currentTarget)}
        onMouseLeave={item_hover.close}
        type="button"
      >
        <ListingIcon listing={listing} size={42} />
      </button>
      {copy && <ItemSnapshotTooltip copy={copy} hover={item_hover.hover} />}
    </>
  )
}
