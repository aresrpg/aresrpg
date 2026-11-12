// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { buyer_total } from '@aresrpg/sdk/marketplace'
import { item_is_stackable } from '@aresrpg/immutable'

import { profession_inventory } from './actor_inventory.ts'
import { owned_character } from './gameplay_context.ts'
import { MARKET_SELL_ACTION } from './market_actions.ts'
import type { GameplayContext } from './gameplay_context.ts'
import type { SelectedAction } from './behavior_targets.ts'

export type BuySelection = Readonly<{
  type: 'buy'
  character_id: string
  item_type: string
  min_amount: number
  max_amount: number
  max_total_mist: string
  order: 'lowest_total' | 'lowest_unit'
}>
export type SellSelection = Readonly<{
  type: 'sell'
  character_id: string
  item_type: string
  amount: number
  price_mist: string
  order: 'smallest_sufficient'
}>
export const select_purchase = (selection: BuySelection, context: GameplayContext): SelectedAction | undefined => {
  const market = context.snapshot.inventory?.market
  if (!market?.complete || market.observation.kind !== 'offers' || market.observation.item_type !== selection.item_type)
    throw new Error('market_unavailable')
  const lots = market.listings
    .filter((row) =>
      [
        row.kind === 'item',
        row.item_type === selection.item_type,
        row.seller !== context.address,
        row.amount >= selection.min_amount,
        row.amount <= selection.max_amount,
        buyer_total(BigInt(row.price_mist)) <= BigInt(selection.max_total_mist),
      ].every(Boolean)
    )
    .toSorted((a, b) => {
      const difference =
        selection.order === 'lowest_unit'
          ? buyer_total(BigInt(a.price_mist)) * BigInt(b.amount) - buyer_total(BigInt(b.price_mist)) * BigInt(a.amount)
          : buyer_total(BigInt(a.price_mist)) - buyer_total(BigInt(b.price_mist))
      return difference === 0n ? a.id.localeCompare(b.id) : difference > 0n ? 1 : -1
    })
  const [lot] = lots
  return lot
    ? {
        kind: 'market_buy',
        payload: {
          character_id: selection.character_id,
          item_id: lot.id,
          seller_kiosk: lot.kiosk,
          listing_version: lot.version,
          item_type: selection.item_type,
          amount: lot.amount,
          price_mist: lot.price_mist,
          max_total_mist: selection.max_total_mist,
        },
      }
    : undefined
}
export const select_sale = (selection: SellSelection, context: GameplayContext) => {
  const character = owned_character(context, selection.character_id)
  const [item] = profession_inventory(context.snapshot.inventory, character.kiosk)
    .filter((row) => row.item_type === selection.item_type && row.amount >= selection.amount)
    .toSorted((a, b) => a.amount - b.amount || a.id.localeCompare(b.id))
  if (!item) return undefined
  if (!item_is_stackable(item.category) && selection.amount !== 1) throw new Error('invalid_market_lot')
  const payload = {
    character_id: character.id,
    source_kiosk: character.kiosk,
    item_id: item.id,
    item_version: item.version,
    item_type: item.item_type,
    source_amount: item.amount,
    amount: selection.amount,
    price_mist: selection.price_mist,
  }
  MARKET_SELL_ACTION.parse(payload)
  return { kind: 'market_sell' as const, payload }
}
