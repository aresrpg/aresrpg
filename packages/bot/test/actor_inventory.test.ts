// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { ListingRow, TradeRow } from '@aresrpg/protocol'

import { empty_inventory, fold_actor_inventory } from '../src/actor_inventory.ts'

const listing = (version: string): ListingRow =>
  ({ id: 'item', kiosk: 'kiosk', version, seller: 'owner' }) as ListingRow
const trade = (offer_revision: number): TradeRow =>
  ({
    id: 'trade',
    a: 'alice',
    b: 'bob',
    offer_revision,
    phase: 'negotiating',
    caps_a: [],
    caps_b: [],
    sui_a: '0',
    sui_b: '0',
    kares_a: '0',
    kares_b: '0',
    accept_a: false,
    accept_b: false,
  }) as TradeRow

test('owned catalogue versions reject older snapshots and preserve newer removals', () => {
  const current = fold_actor_inventory(empty_inventory(), {
    type: 'packet/listings',
    listings: [listing('10')],
    kiosk_versions: { kiosk: '10' },
  })
  const stale = fold_actor_inventory(current, { type: 'packet/listings', listings: [], kiosk_versions: { kiosk: '9' } })
  expect(stale.listings).toEqual([listing('10')])
  const removed = fold_actor_inventory(current, {
    type: 'packet/listings',
    listings: [],
    kiosk_versions: { kiosk: '11' },
  })
  expect(
    fold_actor_inventory(removed, {
      type: 'packet/listings',
      listings: [listing('10')],
      kiosk_versions: { kiosk: '10' },
    }).listings
  ).toEqual([])
})

test('trade projections reject regressing revisions and resurrection after destruction', () => {
  const current = fold_actor_inventory(empty_inventory(), { type: 'packet/trades', trades: [trade(2)] })
  expect(fold_actor_inventory(current, { type: 'packet/trades', trades: [trade(1)] }).trades).toEqual([trade(2)])
  const destroyed = fold_actor_inventory(current, { type: 'packet/trade_destroyed', trade: 'trade' })
  expect(fold_actor_inventory(destroyed, { type: 'packet/trades', trades: [trade(2)] }).trades).toEqual([])
})
