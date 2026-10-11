// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { ListingRow } from '@aresrpg/protocol'

/** Compare equal lots; retain every object's exact rolls and delist identity. */
export const own_listing_stacks = (listings: readonly ListingRow[]) =>
  [
    ...Map.groupBy(listings, (listing) =>
      listing.kind === 'item' && listing.item_type
        ? `item:${listing.item_type}:${listing.amount}`
        : `object:${listing.id}`
    ),
  ].map(([key, rows]) => ({
    key,
    listings: rows.toSorted((left, right) => {
      const difference = BigInt(left.price_mist) - BigInt(right.price_mist)
      return difference < 0n ? -1 : difference > 0n ? 1 : left.id.localeCompare(right.id)
    }),
  }))
