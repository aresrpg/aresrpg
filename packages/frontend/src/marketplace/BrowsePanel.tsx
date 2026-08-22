// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Search, Store } from 'lucide-react'
import { useMemo, useState } from 'react'
import { class_names } from '@aresrpg/immutable'

import { ItemDetailView } from '../components/ItemDetailView.tsx'
import { item_icon } from '../content/assets.ts'
import { content_catalog, titleize } from '../content/catalog.ts'
import type { CopyText } from '../i18n/copy.ts'
import { MARKET_GROUPS, type MarketGroup } from '../modules/marketplace.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { format_sui } from '../wallet_amount.ts'

import {
  buyer_total,
  category_name,
  legal_lot,
  ListingIcon,
  listing_name,
  short_address,
} from './marketplace_model.tsx'

const group_key = (group: MarketGroup): string => `group_${group.toLowerCase()}`

export const BrowsePanel = ({ text }: Readonly<{ text: CopyText }>) => {
  const market = useAppStore(({ marketplace }) => marketplace)
  const address = useAppStore(({ session }) => session.wallet?.address ?? null)
  const balance = useAppStore(({ session }) => session.sui_balance_mist)
  const [subcategory, set_subcategory] = useState<string | null>(null)
  const [selected_type, set_selected_type] = useState<string | null>(null)
  const [search, set_search] = useState('')
  const [confirm, set_confirm] = useState<string | null>(null)
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
  const subcategories = useMemo(
    () => [...new Set(listings.map(({ category }) => category).filter((value): value is string => !!value))].sort(),
    [listings]
  )
  const active_subcategory = subcategories.includes(subcategory ?? '') ? subcategory : (subcategories[0] ?? null)
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
    set_confirm(null)
    dispatch_app({ type: 'market/group_selected', group })
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <aside className="flex w-36 shrink-0 flex-col border-r border-[#1e1e2e]">
        <h3 className="border-b border-[#1e1e2e] px-4 py-3 text-[10px] font-semibold tracking-[0.25em] text-[#c8963c] uppercase">
          {text('browse')}
        </h3>
        <nav className="min-h-0 overflow-y-auto">
          {MARKET_GROUPS.map((group) => (
            <button
              className={`flex w-full cursor-pointer justify-between border-b border-[#1e1e2e] border-l-2 px-3 py-3 text-left text-[9px] tracking-[0.12em] uppercase ${market.group === group ? 'border-l-[#c8963c] bg-[#c8963c]/7 text-[#c8963c]' : 'border-l-transparent text-[#777b86] hover:text-[#e8e4dc]'}`}
              key={group}
              onClick={() => select_group(group)}
              type="button"
            >
              <span>{text(group_key(group))}</span>
              {market.group === group && <span>{listings.length}</span>}
            </button>
          ))}
        </nav>
      </aside>

      {market.group === 'CHARACTERS' ? (
        <section className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 flex-wrap items-end gap-5 border-b border-[#1e1e2e] px-4 py-3">
            <label className="flex flex-col gap-1 text-[8px] tracking-[0.15em] text-[#6b7280] uppercase">
              {text('level')}
              <span className="flex items-center gap-1.5">
                <input
                  className="h-8 w-16 border border-white/10 bg-[#090a10] px-2 text-center text-[9px] outline-none"
                  inputMode="numeric"
                  onChange={(event) => set_minimum_level(event.target.value.replace(/\D/g, ''))}
                  placeholder="MIN"
                  value={minimum_level}
                />
                <span>–</span>
                <input
                  className="h-8 w-16 border border-white/10 bg-[#090a10] px-2 text-center text-[9px] outline-none"
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
                  confirm={confirm}
                  index={index}
                  key={listing.id}
                  listing={listing}
                  pending={market.pending}
                  set_confirm={set_confirm}
                  text={text}
                />
              ))
            )}
          </div>
        </section>
      ) : (
        <>
          {subcategories.length > 1 && (
            <nav className="w-40 shrink-0 overflow-y-auto border-r border-[#1e1e2e]">
              {subcategories.map((category) => (
                <button
                  className={`w-full cursor-pointer border-b border-[#1e1e2e] border-l-2 px-4 py-2.5 text-left text-[9px] tracking-[0.1em] uppercase ${category === active_subcategory ? 'border-l-[#c8963c] bg-[#c8963c]/7 text-[#c8963c]' : 'border-l-transparent text-[#777b86]'}`}
                  key={category}
                  onClick={() => {
                    set_subcategory(category)
                    set_selected_type(null)
                  }}
                  type="button"
                >
                  {category_name(category)}
                </button>
              ))}
            </nav>
          )}
          <section className="flex w-56 shrink-0 flex-col border-r border-[#1e1e2e]">
            <label className="flex items-center gap-2 border-b border-[#1e1e2e] px-3 py-2">
              <Search size={12} className="text-[#555b66]" />
              <input
                className="min-w-0 flex-1 bg-transparent text-[10px] outline-none placeholder:text-[#555b66]"
                onChange={(event) => set_search(event.target.value)}
                placeholder={text('search')}
                value={search}
              />
            </label>
            <div className="min-h-0 overflow-y-auto">
              {types.map(([item_type, rows]) => (
                <button
                  className={`flex w-full cursor-pointer items-center gap-2 border-b border-[#1e1e2e] px-3 py-2 text-left ${item_type === active_type ? 'bg-[#c8963c]/7' : 'hover:bg-white/2'}`}
                  key={item_type}
                  onClick={() => {
                    set_selected_type(item_type)
                    set_confirm(null)
                  }}
                  type="button"
                >
                  <ListingIcon listing={rows[0]!} size={30} />
                  <span className="min-w-0 flex-1 truncate text-[10px] text-[#d8d4cc] uppercase">
                    {listing_name(rows[0]!)}
                  </span>
                  <span className="text-[8px] text-[#6b7280]">{rows.length}</span>
                </button>
              ))}
            </div>
          </section>
          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            {!selected ? (
              <Empty text={text('select_item')} />
            ) : (
              <>
                {item && (
                  <div className="max-h-[48%] shrink-0 overflow-y-auto border-b border-[#1e1e2e] p-5">
                    <ItemDetailView
                      category={item.category}
                      damages={item.damages ?? []}
                      icon={item_icon(item.item_type)}
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
                <div className="flex items-center gap-4 border-b border-[#1e1e2e] bg-[#c8963c]/3 px-5 py-4">
                  <ListingIcon listing={selected[1][0]!} size={52} />
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-[13px] font-semibold tracking-[0.12em] text-[#e8e4dc] uppercase">
                      {item?.name ?? listing_name(selected[1][0]!)}
                    </h3>
                    <p className="mt-1 text-[9px] tracking-[0.12em] text-[#777b86] uppercase">
                      {category_name(item?.category ?? null)} · LV. {item?.level ?? selected[1][0]!.level} ·{' '}
                      {text('listing_count', { count: asks.length })}
                    </p>
                  </div>
                  {item?.stats && (
                    <span className="border border-[#c8963c]/25 px-3 py-1 text-[8px] tracking-[0.12em] text-[#c8963c] uppercase">
                      {text('rolled_stats')}
                    </span>
                  )}
                </div>
                <div className="min-h-0 overflow-y-auto">
                  {asks.map((listing, index) => (
                    <AskRow
                      address={address}
                      balance={balance}
                      confirm={confirm}
                      index={index}
                      key={listing.id}
                      listing={listing}
                      pending={market.pending}
                      set_confirm={set_confirm}
                      text={text}
                    />
                  ))}
                </div>
              </>
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

const AskRow = ({
  address,
  balance,
  confirm,
  index,
  listing,
  pending,
  set_confirm,
  text,
}: Readonly<{
  address: string | null
  balance: bigint | null
  confirm: string | null
  index: number
  listing: import('@aresrpg/protocol').ListingRow
  pending: string | null
  set_confirm: (id: string | null) => void
  text: CopyText
}>) => {
  const total = buyer_total(BigInt(listing.price_mist))
  const own = listing.seller === address
  const insufficient = balance !== null && balance < total
  const armed = confirm === listing.id
  return (
    <div
      className={`flex items-center gap-3 border-b border-[#1e1e2e] px-4 py-2 ${index % 2 ? 'bg-white/[0.018]' : ''}`}
    >
      {listing.kind === 'character' && <ListingIcon listing={listing} size={34} />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[10px] text-[#e8e4dc]">
          {listing.kind === 'character' ? listing.name : short_address(listing.seller)}
        </p>
        <p className="text-[8px] tracking-[0.1em] text-[#6b7280] uppercase">
          {listing.kind === 'character'
            ? `LV. ${listing.level} · ${listing.classe ?? '—'} · ${short_address(listing.seller)}`
            : listing.amount > 1
              ? `×${listing.amount}`
              : text('seller')}
        </p>
      </div>
      <span className="text-[11px] tabular-nums text-[#c8963c]">{format_sui(total, 2)} SUI</span>
      {armed ? (
        <>
          <button
            className="h-8 cursor-pointer border border-[#c8963c]/60 bg-[#c8963c]/10 px-3 text-[8px] tracking-[0.13em] text-[#c8963c] uppercase disabled:opacity-40"
            disabled={!!pending || own || insufficient}
            onClick={() => dispatch_app({ type: 'market/buy_requested', listing })}
            type="button"
          >
            {text('pay')}
          </button>
          <button
            className="h-8 cursor-pointer px-2 text-[8px] text-[#777b86] uppercase"
            onClick={() => set_confirm(null)}
            type="button"
          >
            {text('cancel')}
          </button>
        </>
      ) : (
        <button
          className="h-8 cursor-pointer border border-[#4a9eff]/35 px-3 text-[8px] tracking-[0.13em] text-[#67adff] uppercase disabled:cursor-not-allowed disabled:opacity-35"
          disabled={own || insufficient}
          onClick={() => set_confirm(listing.id)}
          type="button"
        >
          {own ? text('yours') : insufficient ? text('insufficient') : text('buy')}
        </button>
      )}
    </div>
  )
}
