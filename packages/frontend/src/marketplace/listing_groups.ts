// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { ListingRow } from '@aresrpg/protocol'

const compare_price = (left: Readonly<ListingRow>, right: Readonly<ListingRow>): number => {
  const difference = BigInt(left.price_mist) - BigInt(right.price_mist)
  return difference === 0n ? left.id.localeCompare(right.id) : difference < 0n ? -1 : 1
}

const roll_key = (listing: Readonly<ListingRow>): string => {
  // Missing indexed stats cannot prove that two objects are interchangeable.
  if (listing.kind !== 'item' || !listing.stats) return listing.id
  return JSON.stringify([
    listing.item_type,
    listing.category,
    listing.level,
    listing.amount,
    Object.entries(listing.stats).toSorted(([left], [right]) => left.localeCompare(right)),
    (listing.damages ?? []).map(({ element, from, to, damage_type }) => [element, from, to, damage_type]),
  ])
}

/** One exact object per roll, preferring a purchasable offer over the viewer's own listings. */
export const cheapest_identical_items = (listings: readonly ListingRow[], address: string | null): ListingRow[] => {
  const ordered = listings.toSorted(
    (left, right) => Number(left.seller === address) - Number(right.seller === address) || compare_price(left, right)
  )
  const groups = new Map<string, ListingRow>()
  for (const listing of ordered) {
    const key = roll_key(listing)
    if (!groups.has(key)) groups.set(key, listing)
  }
  return [...groups.values()].toSorted(compare_price)
}
