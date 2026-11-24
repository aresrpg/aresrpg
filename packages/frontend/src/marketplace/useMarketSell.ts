// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { item_is_stackable, marketplace_lot_sizes } from '@aresrpg/immutable'
import type { CharacterRow, ItemRow, ListingRow } from '@aresrpg/protocol'
import { useState } from 'react'

import { available_inventory_items, coalesced_stack_groups, encumbered_asset_ids } from '../inventory_stacks.ts'
import { dispatch_app, useSiteStore } from '../store.ts'
import { parse_sui_amount } from '../wallet_amount.ts'

type ItemSelection = Readonly<{
  kind: 'item'
  row: ItemRow
  total_amount: number
  merge_sources: readonly string[]
}>
export type Selection = ItemSelection | Readonly<{ kind: 'character'; row: CharacterRow }>

export const item_listing = (
  row: Readonly<ItemRow>,
  address: string,
  price_mist: bigint
): Omit<ListingRow, 'version'> => ({
  kind: 'item',
  id: row.id,
  name: row.name,
  item_type: row.item_type,
  category: row.category,
  level: row.level,
  amount: row.amount,
  stats: row.stats,
  damages: row.damages,
  pet_power: row.pet_power,
  pet_last_day: row.pet_last_day,
  price_mist: String(price_mist),
  kiosk: row.kiosk,
  seller: address,
  at_ms: Date.now(),
})

export const character_listing = (
  row: Readonly<CharacterRow>,
  address: string,
  price_mist: bigint
): Omit<ListingRow, 'version'> => ({
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

/** The account's items it can list: each unique item, and each stackable type as one stack with the stacks of
 *  the same kiosk that merge into it before the listing. Listed and traded objects are not listable. */
export const sellable_items = (
  inventory: readonly ItemRow[],
  encumbered: ReadonlySet<string>
): readonly ItemSelection[] => [
  ...available_inventory_items(inventory, encumbered)
    .filter((row) => !item_is_stackable(row.category))
    .map((row) => Object.freeze({ kind: 'item' as const, row, total_amount: row.amount, merge_sources: [] })),
  ...coalesced_stack_groups(inventory, encumbered).map(({ target, total_amount, source_ids }) =>
    Object.freeze({ kind: 'item' as const, row: target, total_amount, merge_sources: source_ids })
  ),
]

/** The account's heroes it can list: naked, out of a fight, not listed or traded already. */
export const sellable_characters = (
  characters: readonly CharacterRow[],
  encumbered: ReadonlySet<string>
): readonly CharacterRow[] =>
  characters.filter(
    ({ id, equipment, custody }) => !encumbered.has(id) && custody !== 'fight' && equipment.length === 0
  )

/** The account's sale form: what it can list, the chosen asset, its price and lot, and the one list request. */
export const useMarketSell = () => {
  const session = useSiteStore(({ session }) => session)
  const market = useSiteStore(({ marketplace }) => marketplace)
  const trades = useSiteStore(({ trade }) => trade.rows)
  const [selected_key, set_selected_key] = useState<string | null>(null)
  const [price, set_price] = useState('')
  const [lot, set_lot] = useState(1)
  const encumbered = encumbered_asset_ids(market.own_listings, trades)
  const items = sellable_items(session.inventory, encumbered)
  const characters = sellable_characters(session.characters, encumbered)
  const selections: readonly Selection[] = [...items, ...characters.map((row) => ({ kind: 'character' as const, row }))]
  const selected = selections.find(({ kind, row }) => `${kind}:${row.id}` === selected_key)
  const parsed_price = parse_sui_amount(price)
  const stackable = selected?.kind === 'item' && item_is_stackable(selected.row.category)
  const lot_sizes =
    selected?.kind === 'item' ? marketplace_lot_sizes.filter((amount) => amount <= selected.total_amount) : []
  const can_list =
    !!selected &&
    !!parsed_price &&
    (!stackable || lot_sizes.some((amount) => amount === lot)) &&
    !market.pending &&
    !!session.wallet

  const choose = (selection: Selection): void => {
    set_selected_key(`${selection.kind}:${selection.row.id}`)
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
    set_selected_key(null)
    set_price('')
  }

  return {
    set_selected_key,
    price,
    set_price,
    lot,
    set_lot,
    items,
    characters,
    selected,
    stackable,
    lot_sizes,
    can_list,
    choose,
    list,
  }
}
