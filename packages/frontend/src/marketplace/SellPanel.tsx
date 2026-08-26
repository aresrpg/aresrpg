// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { item_is_stackable } from '@aresrpg/immutable'
import { MIN_CHARACTER_SALE_LEVEL, type CharacterRow, type ItemRow, type ListingRow } from '@aresrpg/protocol'
import { Package, Store, Tag } from 'lucide-react'
import { useMemo, useState } from 'react'

import { item_icon } from '../content/assets.ts'
import { content_catalog } from '../content/catalog.ts'
import type { CopyText } from '../i18n/copy.ts'
import { coalesced_stack_groups, encumbered_asset_ids } from '../inventory_stacks.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { format_sui, parse_sui_amount } from '../wallet_amount.ts'

import { category_name, ListingIcon, listing_name, SuiUnit } from './marketplace_model.tsx'

type ItemSelection = Readonly<{
  kind: 'item'
  row: ItemRow
  total_amount: number
  merge_sources: readonly string[]
}>
type Selection = ItemSelection | Readonly<{ kind: 'character'; row: CharacterRow }>

const item_listing = (row: Readonly<ItemRow>, address: string, price_mist: bigint): ListingRow => ({
  kind: 'item',
  id: row.id,
  name: row.name,
  item_type: row.item_type,
  category: row.category,
  level: row.level,
  amount: row.amount,
  price_mist: String(price_mist),
  kiosk: row.kiosk,
  seller: address,
  at_ms: Date.now(),
})

const character_listing = (row: Readonly<CharacterRow>, address: string, price_mist: bigint): ListingRow => ({
  kind: 'character',
  id: row.id,
  name: row.name,
  item_type: null,
  category: null,
  level: row.level,
  amount: 1,
  classe: row.classe,
  price_mist: String(price_mist),
  kiosk: row.kiosk,
  seller: address,
  at_ms: Date.now(),
})

export const SellPanel = ({ text }: Readonly<{ text: CopyText }>) => {
  const session = useAppStore(({ session }) => session)
  const market = useAppStore(({ marketplace }) => marketplace)
  const trades = useAppStore(({ trade }) => trade.rows)
  const [selected, set_selected] = useState<Selection | null>(null)
  const [price, set_price] = useState('')
  const [lot, set_lot] = useState(1)
  const encumbered = encumbered_asset_ids(market.own_listings, trades)
  const inventory = session.inventory.filter(({ id }) => !encumbered.has(id))
  const stack_groups = coalesced_stack_groups(session.inventory, encumbered)
  const items: readonly ItemSelection[] = [
    ...inventory
      .filter((row) => !item_is_stackable(row.category))
      .map((row) => Object.freeze({ kind: 'item' as const, row, total_amount: row.amount, merge_sources: [] })),
    ...stack_groups.map(({ target, total_amount, source_ids }) =>
      Object.freeze({ kind: 'item' as const, row: target, total_amount, merge_sources: source_ids })
    ),
  ]
  const characters = session.characters.filter(
    ({ id, equipment, level, custody }) =>
      !encumbered.has(id) && custody !== 'fight' && equipment.length === 0 && level >= MIN_CHARACTER_SALE_LEVEL
  )
  const parsed_price = parse_sui_amount(price)
  const stackable = selected?.kind === 'item' && item_is_stackable(selected.row.category)
  const lot_sizes =
    selected?.kind === 'item' ? [1, 10, 100, 1000].filter((amount) => amount <= selected.total_amount) : []
  const can_list =
    !!selected && !!parsed_price && (!stackable || lot_sizes.includes(lot)) && !market.pending && !!session.wallet

  const choose = (selection: Selection): void => {
    set_selected(selection)
    set_price('')
    set_lot(1)
  }
  const list = (): void => {
    if (!selected || !parsed_price || !session.wallet) return
    dispatch_app({
      type: 'market/list_requested',
      listing:
        selected.kind === 'item'
          ? {
              ...item_listing(selected.row, session.wallet.address, parsed_price),
              amount: stackable ? lot : selected.total_amount,
            }
          : character_listing(selected.row, session.wallet.address, parsed_price),
      source_amount: selected.kind === 'item' ? selected.total_amount : 1,
      merge_sources: selected.kind === 'item' ? selected.merge_sources : [],
    })
    set_selected(null)
    set_price('')
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-bg">
      <section className="flex w-[360px] shrink-0 flex-col border-r border-border bg-surface">
        <PanelTitle>
          {text('your_listings')} {market.own_listings.length ? `(${market.own_listings.length})` : ''}
        </PanelTitle>
        <div className="min-h-0 overflow-y-auto">
          {market.own_listings.length === 0 ? (
            <PanelEmpty icon="store" text={text('no_listings')} />
          ) : (
            market.own_listings.map((listing, index) => (
              <div
                className={`flex items-center gap-3 border-b border-white/7 px-4 py-2 ${index % 2 ? 'bg-white/[0.018]' : ''}`}
                key={listing.id}
              >
                <ListingIcon listing={listing} size={30} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[10px] text-[#e8e4dc] uppercase">{listing_name(listing)}</p>
                  <p className="text-[8px] text-[#6b7280] uppercase">
                    {category_name(listing.category)} · LV. {listing.level}
                    {listing.amount > 1 ? ` · ×${listing.amount}` : ''}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1 text-[9px] tabular-nums text-[#c8963c]">
                  {format_sui(BigInt(listing.price_mist), 2)} <SuiUnit />
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

      <section className="flex w-[340px] shrink-0 flex-col border-r border-border bg-surface">
        <PanelTitle>{text('list_for_sale')}</PanelTitle>
        {!selected ? (
          <PanelEmpty icon="tag" text={text('select_to_list')} />
        ) : (
          <div className="mx-4 rounded-[5px] border border-border bg-surface-high p-4">
            <SelectedCard selected={selected} />
            <label className="mt-4 block text-[8px] tracking-[0.18em] text-[#6b7280] uppercase">{text('price')}</label>
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
                onClick={() => set_selected(null)}
                type="button"
              >
                {text('cancel')}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="flex min-w-0 flex-1 flex-col bg-surface-high">
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
                    title={`${row.name} · Lv. ${row.level}`}
                    type="button"
                  >
                    <span>{row.classe.slice(0, 2)}</span>
                    <small>LV.{row.level}</small>
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
                    key={row.id}
                    onClick={() => choose(selection)}
                    title={`${item?.name ?? row.name} · Lv. ${row.level}`}
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
          {category_name(listing.category)} · LV. {listing.level}
          {listing.amount > 1 ? ` · ×${listing.amount}` : ''}
        </p>
      </div>
    </div>
  )
}
