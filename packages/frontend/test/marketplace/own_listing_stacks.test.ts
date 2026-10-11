// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import type { ListingRow } from '@aresrpg/protocol'

import { own_listing_stacks } from '../../src/marketplace/own_listing_stacks.ts'

const listing = (id: string, price_mist: string, amount = 1): ListingRow => ({
  id,
  price_mist,
  amount,
  kind: 'item',
  item_type: 'recall_potion',
  category: 'consumable',
  name: 'Recall Potion',
  level: 1,
  kiosk: 'kiosk',
  seller: 'seller',
  at_ms: 0,
  version: '1',
})

test('matching lots sort exact integer prices without merging their identities or changing the input', () => {
  const rows = [listing('higher', '9007199254740993'), listing('lower', '9007199254740992'), listing('bulk', '1', 10)]
  const stacks = own_listing_stacks(rows)
  expect(stacks.map(({ listings }) => listings.map(({ id }) => id))).toEqual([['lower', 'higher'], ['bulk']])
  expect(rows.map(({ id }) => id)).toEqual(['higher', 'lower', 'bulk'])
  expect(stacks[0]!.listings[0]).toBe(rows[1]!)
})

test('characters and unknown item types remain individually identifiable', () => {
  const rows = [
    { ...listing('one', '1'), kind: 'character' as const, item_type: null, category: null },
    { ...listing('two', '2'), kind: 'character' as const, item_type: null, category: null },
    { ...listing('unknown-one', '1'), item_type: null },
    { ...listing('unknown-two', '1'), item_type: null },
  ]
  expect(own_listing_stacks(rows)).toHaveLength(4)
})
