// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import type { ItemRow } from '@aresrpg/protocol'

import { crush_selection, select_inventory_item } from '../../src/characters/inventory_selection.ts'
import { owned_item_details } from '../../src/components/OwnedItemDetail.tsx'

const item = (id: string): ItemRow => ({
  id,
  name: 'Hat',
  item_type: 'hat',
  category: 'hat',
  level: 10,
  amount: 1,
  kiosk: 'kiosk',
  stats: { strength: 32779, wisdom: 32764 },
})

test('Shift toggles selection while a normal click replaces it', () => {
  expect(select_inventory_item(['a'], 'b', true)).toEqual(['a', 'b'])
  expect(select_inventory_item(['a', 'b'], 'a', true)).toEqual(['b'])
  expect(select_inventory_item(['a', 'b'], 'c', false)).toEqual(['c'])
})

test('crushing requires the complete, still-available reviewed set in one kiosk', () => {
  const first = item('a'),
    second = item('b')
  const items = [first, second]
  expect(crush_selection(items, items, new Set())).toEqual(items)
  expect(crush_selection(items, [first], new Set())).toBeNull()
  expect(crush_selection(items, items, new Set(['b']))).toBeNull()
  expect(crush_selection(items, [first, { ...second, kiosk: 'other' }], new Set())).toBeNull()
  expect(
    crush_selection([first, { ...second, kiosk: 'other' }], [first, { ...second, kiosk: 'other' }], new Set())
  ).toBeNull()
  expect(crush_selection([first, first], items, new Set())).toBeNull()
  expect(crush_selection([], items, new Set())).toBeNull()
  expect(crush_selection(items, [first, { ...second, stats: undefined }], new Set())).toBeNull()
})

test('owned details show signed rolls rather than template ranges and preserve actual weapon damage', () => {
  const gear = { ...item('a'), damages: [{ element: 'fire', from: 3, to: 7, damage_type: 'damage' }] }
  const detail = owned_item_details(gear)
  expect(detail.stats).toEqual({ min: { wisdom: -4, strength: 11 }, max: { wisdom: -4, strength: 11 } })
  expect(detail.damages).toEqual(gear.damages)
  expect(owned_item_details({ ...gear, category: 'pet', pet_power: 30 }).stats.min).toEqual({ wisdom: -2, strength: 5 })
  expect(owned_item_details({ ...gear, stats: undefined }).stats.min).toEqual({})
})
