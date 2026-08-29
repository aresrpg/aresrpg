// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { item_is_stackable } from '@aresrpg/immutable'
import type { ItemRow, TradeCapRow } from '@aresrpg/protocol'

export type TradeOfferAddition = Readonly<{ item: Readonly<ItemRow>; amount: number }>
export type TradeOfferRemoval = Readonly<{
  cap: Readonly<TradeCapRow>
  target?: Readonly<{ id: string; kiosk: string; amount: number }>
}>

const removal_source_ids = (removals: readonly TradeOfferRemoval[]): ReadonlySet<string> => {
  const source_ids = new Set<string>()
  for (const { cap } of removals) {
    if (source_ids.has(cap.object)) throw new Error('One offered object cannot be removed twice.')
    source_ids.add(cap.object)
  }
  return source_ids
}

const removal_destination_amount = (
  amounts: ReadonlyMap<string, number>,
  target_bases: Map<string, number>,
  { cap, target }: Readonly<TradeOfferRemoval>
): readonly [string, number] => {
  if (!target) return [cap.object, cap.amount]
  const base = target_bases.get(target.id)
  if (base !== undefined && base !== target.amount)
    throw new Error('Offer removals disagree about their merge target amount.')
  target_bases.set(target.id, target.amount)
  const amount = (amounts.get(target.id) ?? target.amount) + cap.amount
  if (!Number.isSafeInteger(target.amount) || target.amount < 1 || amount > 0xffff_ffff)
    throw new Error('An offer removal merge target cannot absorb that stack.')
  return [target.id, amount]
}

export const trade_offer_post_removal_amounts = (
  removals: readonly TradeOfferRemoval[]
): ReadonlyMap<string, number> => {
  const source_ids = removal_source_ids(removals)
  if (removals.some(({ target }) => target && source_ids.has(target.id)))
    throw new Error('An offered object cannot absorb another offer removal.')
  const amounts = new Map<string, number>()
  const target_bases = new Map<string, number>()
  for (const removal of removals) {
    const [id, amount] = removal_destination_amount(amounts, target_bases, removal)
    amounts.set(id, amount)
  }
  return amounts
}

const assert_addition_amount = ({ item, amount }: Readonly<TradeOfferAddition>, available_amount: number): void => {
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > available_amount)
    throw new Error('A trade stack amount must be a positive available integer.')
  if (amount !== available_amount && !item_is_stackable(item.category))
    throw new Error('A unique item cannot be split for trade.')
}

const assert_offer_additions = (
  additions: readonly TradeOfferAddition[],
  post_removal_amounts: ReadonlyMap<string, number>
): void => {
  const used = new Set<string>()
  for (const { item, amount } of additions) {
    if (used.has(item.id)) throw new Error('One inventory object cannot be added twice.')
    used.add(item.id)
    const available_amount = post_removal_amounts.get(item.id) ?? item.amount
    assert_addition_amount({ item, amount }, available_amount)
  }
}

const assert_offer_removals = (
  removals: readonly TradeOfferRemoval[],
  own_caps: readonly TradeCapRow[],
  additions: readonly TradeOfferAddition[]
): void => {
  const own_ids = new Set(own_caps.map(({ object }) => object))
  if (removals.some(({ cap }) => !own_ids.has(cap.object)))
    throw new Error('An offer removal does not belong to your rendered side.')
  if (removals.some(({ cap, target }) => target && (target.kiosk !== cap.kiosk || target.id === cap.object)))
    throw new Error('An offer removal merge target must be a different item in the same kiosk.')
  if (removals.some(({ cap, target }) => target && !item_is_stackable(cap.category)))
    throw new Error('A unique offer item cannot be merged.')
  const addition_ids = new Set(additions.map(({ item }) => item.id))
  if (removals.some(({ cap, target }) => target && addition_ids.has(cap.object)))
    throw new Error('A re-added offer item cannot also be merged.')
}

export const trade_offer_kiosks = (
  additions: readonly TradeOfferAddition[],
  removals: readonly TradeOfferRemoval[],
  own_caps: readonly TradeCapRow[],
  sui: bigint,
  own_sui: bigint
): readonly string[] => {
  if (sui < 0n) throw new Error('The offered SUI amount cannot be negative.')
  assert_offer_removals(removals, own_caps, additions)
  const post_removal_amounts = trade_offer_post_removal_amounts(removals)
  assert_offer_additions(additions, post_removal_amounts)
  if (additions.length + removals.length + (sui === own_sui ? 0 : 1) === 0)
    throw new Error('The trade offer is unchanged.')
  return Object.freeze([
    ...new Set([...additions.map(({ item }) => item.kiosk), ...removals.map(({ cap }) => cap.kiosk)]),
  ])
}
