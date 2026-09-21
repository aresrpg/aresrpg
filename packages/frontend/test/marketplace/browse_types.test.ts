// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { ListingRow } from '@aresrpg/protocol'

import { content_catalog } from '../../src/content/catalog.ts'
import { browse_types, cheapest_offers } from '../../src/marketplace/browse_types.ts'

test('a listed resource remains discoverable without any row in the bounded listing window', () => {
  const [first, missing] = content_catalog.items.filter(({ category }) => category === 'resource')
  const types = [first!, missing!].map(({ item_type, name, level }) => ({
    item_type,
    category: 'resource' as const,
    name,
    level,
  }))
  const listings = Array.from({ length: 200 }, (_, index) => ({ ...first!, kind: 'item', id: String(index) }))
  const rows = browse_types(types, listings as never, 'resource', '')
  expect(rows.map(({ item_type }) => item_type)).toContain(missing!.item_type)
  expect(rows.find(({ item_type }) => item_type === missing!.item_type)?.rows).toEqual([])
  expect(browse_types(types, listings as never, 'resource', missing!.name).map(({ item_type }) => item_type)).toContain(
    missing!.item_type
  )
})

test('one cheapest exact offer per server group retains unknown objects and advances to backups', () => {
  const listing = {
    kind: 'item',
    item_type: 'hat',
    category: 'hat',
    amount: 1,
    level: 1,
    name: 'Hat',
    version: '1',
    seller: 'seller',
    kiosk: 'kiosk',
    at_ms: 0,
  } as const
  const rows: ListingRow[] = [
    { ...listing, id: 'backup', group_key: 'roll:a', price_mist: '9007199254740993' },
    { ...listing, id: 'best', group_key: 'roll:a', price_mist: '9007199254740992' },
    { ...listing, id: 'different', group_key: 'roll:b', price_mist: '1' },
    { ...listing, id: 'unknown_a', price_mist: '2' },
    { ...listing, id: 'unknown_b', price_mist: '2' },
  ]
  expect(cheapest_offers(rows).map(({ id }) => id)).toEqual(['different', 'unknown_a', 'unknown_b', 'best'])
  expect(cheapest_offers(rows.filter(({ id }) => id !== 'best')).at(-1)?.id).toBe('backup')
  expect(cheapest_offers([...rows].reverse())).toEqual(cheapest_offers(rows))
  expect(rows).toHaveLength(5)
})
