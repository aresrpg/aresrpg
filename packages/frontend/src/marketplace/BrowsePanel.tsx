// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Search, Store } from 'lucide-react'
import { useMemo, useState } from 'react'
import { class_names, item_is_stackable, marketplace_lot_sizes } from '@aresrpg/immutable'
import type { ListingRow } from '@aresrpg/protocol'

import { ItemDetailView } from '../components/ItemDetailView.tsx'
import { content_catalog } from '../content/catalog.ts'
import type { CopyText } from '../i18n/copy.ts'
import { MARKET_GROUPS, market_group_count, market_observation, type MarketGroup } from '../modules/marketplace.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { format_sui } from '../wallet_amount.ts'

import {
  buyer_total,
  category_name,
  legal_lot,
  ListingIcon,
  listing_name,
  short_address,
  SuiUnit,
} from './marketplace_model.tsx'

const group_key = (group: MarketGroup): string => `group_${group.toLowerCase()}`

export const BrowsePanel = ({ text }: Readonly<{ text: CopyText }>) => {
  const market = useAppStore(({ marketplace }) => marketplace)
  const address = useAppStore(({ session }) => session.wallet?.address ?? null)
  const balance = useAppStore(({ session }) => session.sui_balance_mist)
  const [subcategory, set_subcategory] = useState<string | null>(null)
  const [selected_type, set_selected_type] = useState<string | null>(null)
  const [search, set_search] = useState('')
  const [minimum_level, set_minimum_level] = useState('')
  const [maximum_level, set_maximum_level] = useState('')
  const [character_class, set_character_class] = useState<string | null>(null)
  const listings = market.listings.filter(legal_lot)
  const character_listings = useMemo(() => {
    const minimum = Number(minimum_level) || 0
    const maximum = Number(maximum_level) || Number.POSITIVE_INFINITY
    return listings.filter(
      (listing) =>
        listing.kind === 'character' &&
        listing.level >= minimum &&
        listing.level <= maximum &&
        (!character_class || listing.classe === character_class)
    )
  }, [character_class, listings, maximum_level, minimum_level])
  const subcategories = useMemo(() => {
    if (market.group === 'CHARACTERS') return []
    const authored = new Set<string>(content_catalog.items.map(({ category }) => category))
    return market_observation(market.group).categories.filter(
      (category) => authored.has(category) || (market.counts.categories[category] ?? 0) > 0
    )
  }, [market.counts.categories, market.group])
  const active_subcategory = subcategories.some((category) => category === subcategory)
    ? subcategory
    : (subcategories[0] ?? null)
  const types = useMemo(() => {
    const query = search.trim().toLowerCase()
    const grouped = new Map<string, typeof listings>()
    for (const listing of listings) {
      if (listing.kind !== 'item' || listing.category !== active_subcategory || !listing.item_type) continue
      const name = listing_name(listing)
      if (query && !`${name} ${listing.item_type}`.toLowerCase().includes(query)) continue
      grouped.set(listing.item_type, [...(grouped.get(listing.item_type) ?? []), listing])
    }
    return [...grouped.entries()].sort(([left], [right]) => {
      const a = content_catalog.item(left)?.item.level ?? 0
      const b = content_catalog.item(right)?.item.level ?? 0
      return a - b || left.localeCompare(right)
    })
  }, [active_subcategory, listings, search])
  const active_type = types.some(([item_type]) => item_type === selected_type) ? selected_type : (types[0]?.[0] ?? null)
  const selected = types.find(([item_type]) => item_type === active_type) ?? null
  const asks = selected ? selected[1].toSorted((a, b) => Number(BigInt(a.price_mist) - BigInt(b.price_mist))) : []
  const item = active_type ? (content_catalog.item(active_type)?.item ?? null) : null

  const select_group = (group: MarketGroup): void => {
    set_subcategory(null)
    set_selected_type(null)
    set_search('')
    dispatch_app({ type: 'market/group_selected', group })
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-bg">
      <aside className="flex w-36 shrink-0 flex-col border-r border-border bg-surface-low">
        <h3 className="border-b border-white/10 px-4 py-3 text-[10px] font-semibold tracking-[0.25em] text-[#c8963c] uppercase">
          {text('browse')}
        </h3>
        <nav aria-label={text('browse')} className="min-h-0 overflow-y-auto" data-marketplace-general-categories>
          {MARKET_GROUPS.map((group) => (
            <button
              className={`flex w-full cursor-pointer justify-between border-b border-white/7 border-l-2 px-3 py-2.5 text-left text-[9px] tracking-[0.12em] uppercase ${market.group === group ? 'border-l-[#c8963c] bg-[#c8963c]/7 text-[#efbd45]' : 'border-l-transparent text-[#858b98] hover:bg-white/[0.045] hover:text-[#e6e2da]'}`}
              key={group}
              onClick={() => select_group(group)}
              type="button"
            >
              <span>{text(group_key(group))}</span>
              <span className="text-[8px] tabular-nums text-[#626773]">
                {market_group_count(group, market.counts, group === market.group ? listings.length : 0)}
              </span>
            </button>
          ))}
        </nav>
      </aside>

      {market.group === 'CHARACTERS' ? (
        <section className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 flex-wrap items-end gap-5 border-b border-border bg-surface-high px-4 py-3">
            <label className="flex flex-col gap-1 text-[8px] tracking-[0.15em] text-[#6b7280] uppercase">
              {text('level')}
              <span className="flex items-center gap-1.5">
                <input
                  className="h-8 w-16 border border-white/10 bg-bg px-2 text-center text-[9px] outline-none"
                  inputMode="numeric"
                  onChange={(event) => set_minimum_level(event.target.value.replace(/\D/g, ''))}
                  placeholder="MIN"
                  value={minimum_level}
                />
                <span>–</span>
                <input
                  className="h-8 w-16 border border-white/10 bg-bg px-2 text-center text-[9px] outline-none"
                  inputMode="numeric"
                  onChange={(event) => set_maximum_level(event.target.value.replace(/\D/g, ''))}
                  placeholder="MAX"
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
              className="w-40 shrink-0 overflow-y-auto border-r border-border bg-surface py-1"
              data-marketplace-item-types
            >
              {subcategories.map((category) => (
                <button
                  className={`w-full cursor-pointer border-l-2 px-3 py-2 text-left text-[8px] tracking-[0.1em] uppercase ${category === active_subcategory ? 'border-l-[#c8963c] bg-white/[0.035] text-[#e8e4dc]' : 'border-l-transparent text-[#858b98] hover:bg-white/[0.045] hover:text-[#e6e2da]'}`}
                  key={category}
                  onClick={() => {
                    set_subcategory(category)
                    set_selected_type(null)
                  }}
                  type="button"
                >
                  <span className="flex items-center justify-between gap-3">
                    <span>{category_name(category)}</span>
                    <span className="text-[8px] tabular-nums text-[#626773]">
                      {Math.max(
                        market.counts.categories[category] ?? 0,
                        category === active_subcategory
                          ? listings.filter((listing) => listing.category === category).length
                          : 0
                      )}
                    </span>
                  </span>
                </button>
              ))}
            </nav>
          )}
          <section
            className="flex w-56 shrink-0 flex-col border-r border-border bg-surface"
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
              {types.map(([item_type, rows]) => (
                <button
                  className={`flex w-full cursor-pointer items-center gap-2 border-l-2 px-2 py-1.5 text-left text-[9px] ${item_type === active_type ? 'border-l-[#4a9eff] bg-[#4a9eff]/6 text-[#b9d8ff]' : 'border-l-transparent text-[#969ba7] hover:bg-white/[0.045] hover:text-[#ebe7df]'}`}
                  key={item_type}
                  onClick={() => {
                    set_selected_type(item_type)
                  }}
                  type="button"
                >
                  <ListingIcon listing={rows[0]!} size={30} />
                  <span className="min-w-0 flex-1 truncate text-[10px] text-[#d8d4cc] uppercase">
                    {listing_name(rows[0]!)}
                  </span>
                </button>
              ))}
            </div>
          </section>
          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            {!selected ? (
              <Empty text={text('select_item')} />
            ) : (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex shrink-0 items-center gap-3 border-b border-border bg-surface-raised px-4 py-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.16)]">
                  <ListingIcon listing={selected[1][0]!} size={28} />
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-[10px] font-semibold tracking-[0.2em] text-[#e8e4dc] uppercase">
                      {item?.name ?? listing_name(selected[1][0]!)}
                    </h3>
                  </div>
                  {(item?.level ?? selected[1][0]!.level) > 0 && (
                    <span className="text-[8px] text-[#6b7280]">LV. {item?.level ?? selected[1][0]!.level}</span>
                  )}
                  {asks[0] && (
                    <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold tabular-nums text-[#f0c66c]">
                      {format_sui(buyer_total(BigInt(asks[0].price_mist)), 2)} <SuiUnit />
                    </span>
                  )}
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto bg-surface-high p-4">
                  <div className="flex min-h-full flex-col gap-4">
                    {item && (
                      <div className="rounded-[5px] border border-border bg-surface p-4 shadow-[0_10px_28px_rgba(0,0,0,0.16)]">
                        <ItemDetailView
                          category={item.category}
                          damages={item.damages ?? []}
                          item_type={item.item_type}
                          labels={{
                            characteristics: text('characteristics'),
                            damages: text('damages'),
                            level_short: `LV. ${item.level}`,
                            range_to: text('range_to'),
                          }}
                          level={item.level}
                          name={item.name}
                          stats={item.stats}
                        />
                      </div>
                    )}
                    <div data-marketplace-listings>
                      <CheapestLotMarket
                        address={address}
                        asks={asks}
                        balance={balance}
                        pending={market.pending}
                        sizes={
                          item_is_stackable(item?.category ?? selected[1][0]!.category ?? '')
                            ? marketplace_lot_sizes
                            : [1]
                        }
                        text={text}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
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
  sizes,
  text,
}: Readonly<{
  address: string | null
  asks: readonly ListingRow[]
  balance: bigint | null
  pending: string | null
  sizes: readonly number[]
  text: CopyText
}>) => {
  return (
    <div
      className="mx-auto w-full max-w-[560px] overflow-hidden rounded-[5px] border border-border bg-surface shadow-[0_10px_28px_rgba(0,0,0,0.16)]"
      data-marketplace-lot-market
    >
      <div className="grid grid-cols-[72px_minmax(100px,180px)_minmax(80px,110px)] items-center justify-center gap-4 border-b border-border bg-surface-high px-4 py-2 text-[8px] tracking-[0.16em] text-[#6d7382] uppercase">
        <span>{text('lot_size')}</span>
        <span>{text('price')}</span>
        <span className="text-center">{text('buy')}</span>
      </div>
      <div className="divide-y divide-white/7">
        {sizes.map((size, index) => {
          const ask = asks.find(({ amount }) => amount === size) ?? null
          const total = ask ? buyer_total(BigInt(ask.price_mist)) : null
          const insufficient = total !== null && balance !== null && balance < total
          const own = ask?.seller === address
          const purchasable = !!ask && !own && !insufficient && !pending
          return (
            <div
              className={`grid min-h-18 min-w-0 grid-cols-[72px_minmax(100px,180px)_minmax(80px,110px)] items-center justify-center gap-4 px-4 py-2 ${index % 2 ? 'bg-white/[0.018]' : ''}`}
              data-marketplace-cheapest-lot={size}
              data-marketplace-listing-row
              key={size}
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
                      {format_sui(total, 2)} <SuiUnit size={12} />
                    </span>
                  )}
                </span>
              </div>
              <button
                className="h-10 w-full min-w-0 cursor-pointer overflow-hidden border border-[#c8963c]/45 bg-[#c8963c]/8 px-3 text-ellipsis whitespace-nowrap text-[8px] font-semibold tracking-[0.13em] text-[#efbd45] uppercase hover:bg-[#c8963c]/13 disabled:cursor-not-allowed disabled:border-white/7 disabled:bg-transparent disabled:text-[#555b66]"
                disabled={!purchasable}
                onClick={() => {
                  if (ask) dispatch_app({ type: 'market/buy_requested', listing: ask })
                }}
                type="button"
              >
                {!ask ? '—' : own ? text('yours') : insufficient ? text('insufficient') : text('buy')}
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
  text,
}: Readonly<{
  address: string | null
  balance: bigint | null
  index: number
  listing: ListingRow
  pending: string | null
  text: CopyText
}>) => {
  const total = buyer_total(BigInt(listing.price_mist))
  const own = listing.seller === address
  const insufficient = balance !== null && balance < total
  const purchasable = !own && !insufficient && !pending
  return (
    <div
      className={`flex min-w-0 items-center gap-2 border-b border-white/7 px-3 py-2 transition-colors ${index % 2 ? 'bg-white/[0.018]' : ''}`}
      data-marketplace-listing-row
    >
      <ListingIcon listing={listing} size={34} />
      <div className="flex min-w-0 flex-[1_1_130px] flex-col">
        <span className="text-[7px] tracking-[0.16em] text-[#555b66] uppercase">{text('seller')}</span>
        <span className="truncate text-[9px] tracking-[0.08em] text-[#a2a6ae]">
          {listing.kind === 'character' ? listing.name : short_address(listing.seller)}
        </span>
        {listing.kind === 'character' && (
          <span className="truncate text-[7px] text-[#646a75]">
            LV. {listing.level} · {listing.classe ?? '—'} · {short_address(listing.seller)}
          </span>
        )}
      </div>
      {listing.amount > 1 && (
        <span className="shrink-0 text-[9px] tracking-[0.15em] text-[#777b86]">×{listing.amount}</span>
      )}
      <span className="min-w-2 flex-1" />
      <div className="flex min-w-0 max-w-28 shrink flex-col items-end overflow-hidden">
        <span className="text-[7px] tracking-[0.16em] text-[#555b66] uppercase">{text('price')}</span>
        <span className="max-w-full truncate whitespace-nowrap text-[10px] tabular-nums text-[#c8963c]">
          {format_sui(total, 2)} <SuiUnit />
        </span>
      </div>
      <button
        className="h-8 min-w-0 max-w-24 shrink cursor-pointer overflow-hidden border border-[#c8963c]/35 px-2 text-ellipsis whitespace-nowrap text-[8px] tracking-[0.12em] text-[#c8963c] uppercase disabled:cursor-not-allowed disabled:opacity-35"
        disabled={!purchasable}
        onClick={(event) => {
          event.stopPropagation()
          if (purchasable) dispatch_app({ type: 'market/buy_requested', listing })
        }}
        type="button"
      >
        {own ? text('yours') : insufficient ? text('insufficient') : text('buy')}
      </button>
    </div>
  )
}
