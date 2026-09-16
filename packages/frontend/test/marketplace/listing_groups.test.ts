// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import type { ListingRow } from '@aresrpg/protocol'

import { cheapest_identical_items } from '../../src/marketplace/listing_groups.ts'

const item = (id: string, price_mist: string, stats: ListingRow['stats'] = { wisdom: 10001 }): ListingRow => ({
  id,
  price_mist,
  stats,
  kind: 'item',
  item_type: 'pickaxe',
  category: 'pickaxe',
  name: 'Pickaxe',
  version: '1',
  level: 1,
  amount: 1,
  kiosk: 'kiosk',
  seller: 'seller',
  at_ms: 0,
})

test('five wisdom rolls yield five rows, independent of price and stat key insertion order', () => {
  const listings = Array.from({ length: 20 }, (_, index) =>
    item(String(index), String(index + 10), { wisdom: 10001 + (index % 5) })
  )
  expect(cheapest_identical_items(listings, 'buyer')).toHaveLength(5)
  const same = [
    item('a', '20', { wisdom: 10001, strength: 10002 }),
    item('b', '10', { strength: 10002, wisdom: 10001 }),
  ]
  expect(cheapest_identical_items(same, 'buyer').map(({ id }) => id)).toEqual(['b'])
})

test('own offers cannot hide a purchasable copy; removing it exposes the next exact object', () => {
  const own = { ...item('own', '1'), seller: 'buyer' }
  const offers = [own, item('expensive', '30'), item('cheap', '10')]
  expect(cheapest_identical_items(offers, 'buyer')).toEqual([offers[2]!])
  expect(cheapest_identical_items(offers.slice(0, 2), 'buyer')).toEqual([offers[1]!])
  expect(cheapest_identical_items([own], 'buyer')).toEqual([own])
})

test('different weapon damage, templates, and unknown stats remain separate', () => {
  const base = item('a', '10')
  const offers = [
    base,
    { ...base, id: 'b', damages: [{ element: 'fire', from: 1, to: 2, damage_type: 'damage' }] },
    { ...base, id: 'c', item_type: 'other' },
    { ...base, id: 'd', stats: undefined },
    { ...base, id: 'e', stats: undefined },
  ]
  expect(cheapest_identical_items(offers, null)).toHaveLength(5)
})
