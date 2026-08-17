// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { is_equipment_category, item_is_stackable } from '@aresrpg/immutable'
import { MAX_NON_STACKABLE_PURCHASE_QUANTITY } from '@aresrpg/sdk/shop'

import type { SeedItem } from '../content/catalog.ts'

export const SHOP_SECTION_ORDER = Object.freeze([
  'pet_box',
  'title',
  'cloak',
  'hat',
  'companion',
  'equipment',
  'consumable',
  'resource',
] as const)

export type ShopSection = (typeof SHOP_SECTION_ORDER)[number]

export const shop_section = (item: SeedItem): ShopSection => {
  if (item.consumable?.type === 'loot_box') return 'pet_box'
  if (item.category === 'pet') return 'companion'
  if (item.category === 'title' || item.category === 'cloak' || item.category === 'hat') return item.category
  if (item.category === 'resource') return 'resource'
  if (item.category === 'consumable') return 'consumable'
  return is_equipment_category(item.category) ? 'equipment' : 'consumable'
}

export const purchase_limit = ({
  balance_mist,
  category,
  price_mist,
  stock,
}: Readonly<{
  balance_mist: bigint | null
  category: string
  price_mist: bigint
  stock: number
}>): number => {
  if (stock < 1 || price_mist < 1n) return 0
  const affordable = balance_mist === null ? stock : Number(balance_mist / price_mist)
  const transaction_limit = item_is_stackable(category) ? 4_294_967_295 : MAX_NON_STACKABLE_PURCHASE_QUANTITY
  return Math.min(stock, Math.max(0, affordable), transaction_limit)
}

export const loot_box_odds = (item: SeedItem) => {
  if (item.consumable?.type !== 'loot_box') return Object.freeze([])
  const total = item.consumable.rewards.reduce((sum, { weight }) => sum + weight, 0)
  return Object.freeze(
    item.consumable.rewards.map((reward) =>
      Object.freeze({ ...reward, percent: total > 0 ? (reward.weight / total) * 100 : 0 })
    )
  )
}
