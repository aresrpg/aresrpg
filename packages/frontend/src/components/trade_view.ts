// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { item_is_stackable } from '@aresrpg/immutable'
import type { ItemRow, TradeCapRow, TradePhase, TradeRow } from '@aresrpg/protocol'
import { trade_offer_post_removal_amounts, type TradeOfferRemoval } from '@aresrpg/sdk/trade'

import { format_sui } from '../wallet_amount.ts'

export type TradeInventoryCategory = 'equipment' | 'consumables' | 'resources'
export type TradeNameRow = Readonly<{ owner: string; name: string }>
export type TradeDraftAddition = Readonly<{ item: Readonly<ItemRow>; amount: number }>

export const TRADE_INVENTORY_CATEGORIES = Object.freeze(['equipment', 'consumables', 'resources'] as const)

export const trade_inventory_category = (item: Readonly<ItemRow>): TradeInventoryCategory => {
  if (item.category === 'consumable') return 'consumables'
  if (item.category === 'resource' || item.category === 'rune' || item.category === 'key') return 'resources'
  return 'equipment'
}

export const stage_trade_addition = (
  additions: readonly TradeDraftAddition[],
  item: Readonly<ItemRow>,
  amount: number
): readonly TradeDraftAddition[] => {
  const existing = additions.find((addition) => addition.item.id === item.id)
  const staged = Math.min(existing?.item.amount ?? item.amount, (existing?.amount ?? 0) + amount)
  const next = Object.freeze({ item: existing?.item ?? item, amount: staged })
  return Object.freeze(
    existing ? additions.map((addition) => (addition.item.id === item.id ? next : addition)) : [...additions, next]
  )
}

export const stage_trade_offer_addition = (
  additions: readonly TradeDraftAddition[],
  kept_caps: readonly Readonly<TradeCapRow>[],
  item: Readonly<ItemRow>,
  amount: number
): Readonly<{ additions: readonly TradeDraftAddition[]; kept_caps: readonly TradeCapRow[] }> => {
  const absorbed = item_is_stackable(item.category)
    ? kept_caps.filter(({ item_type, kiosk }) => item_type === item.item_type && kiosk === item.kiosk)
    : []
  const absorbed_ids = new Set(absorbed.map(({ object }) => object))
  const absorbed_amount = absorbed.reduce((total, cap) => total + cap.amount, 0)
  const combined_item = absorbed_amount > 0 ? Object.freeze({ ...item, amount: item.amount + absorbed_amount }) : item
  return Object.freeze({
    additions: stage_trade_addition(additions, combined_item, amount + absorbed_amount),
    kept_caps: Object.freeze(kept_caps.filter(({ object }) => !absorbed_ids.has(object))),
  })
}

export const trade_draft_inventory = (
  inventory: readonly Readonly<ItemRow>[],
  encumbered: ReadonlySet<string>,
  additions: readonly TradeDraftAddition[],
  removals: readonly TradeOfferRemoval[] = []
): readonly ItemRow[] => {
  const staged = new Map(additions.map(({ item, amount }) => [item.id, amount]))
  const returned_caps = removals.map(({ cap }) => cap)
  const returned_ids = new Set(returned_caps.map(({ object }) => object))
  const merged_source_ids = new Set(removals.flatMap(({ cap, target }) => (target ? [cap.object] : [])))
  const post_removal_amounts = trade_offer_post_removal_amounts(removals)
  const returned = new Map<string, ItemRow>()
  for (const { object: id, name, item_type, category, level, amount, kiosk } of returned_caps) {
    if (!merged_source_ids.has(id))
      returned.set(id, Object.freeze({ id, name, item_type, category, level, amount, kiosk }))
  }
  const inventory_ids = new Set(inventory.map(({ id }) => id))
  const rows = [...inventory, ...[...returned.values()].filter(({ id }) => !inventory_ids.has(id))]
  return Object.freeze(
    rows.flatMap((item) => {
      if (merged_source_ids.has(item.id)) return []
      if (encumbered.has(item.id) && !returned_ids.has(item.id)) return []
      const amount = (post_removal_amounts.get(item.id) ?? item.amount) - (staged.get(item.id) ?? 0)
      return amount > 0 ? [Object.freeze({ ...item, amount })] : []
    })
  )
}

export const trade_display_name = (
  address: string,
  own_address: string | null | undefined,
  own_name: string | null | undefined,
  players: readonly TradeNameRow[]
): string => {
  const normalized = address.toLowerCase()
  if (own_name && own_address?.toLowerCase() === normalized) return own_name
  return (
    players.find(({ owner }) => owner.toLowerCase() === normalized)?.name ??
    `${address.slice(0, 7)}…${address.slice(-5)}`
  )
}

export const input_sui = (mist: bigint): string => format_sui(mist, 9).replace(/0+$/, '').replace(/\.$/, '')

export const trade_modal_visible = (trade: Readonly<TradeRow>): boolean =>
  trade.phase !== 'requested' &&
  (trade.phase === 'negotiating' ||
    trade.caps_a.length > 0 ||
    trade.caps_b.length > 0 ||
    BigInt(trade.sui_a) > 0n ||
    BigInt(trade.sui_b) > 0n)

export const trade_cap_action = ({ phase, own }: Readonly<{ phase: TradePhase; own: boolean }>): 'withdraw' | null =>
  phase === 'negotiating' && own ? 'withdraw' : null
