// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import type { ItemRow } from '@aresrpg/protocol'
import { renderToStaticMarkup } from 'react-dom/server'

import { bag_item_matches, InventoryResourceFilters } from '../../src/characters/InventoryResourceFilters.tsx'
import { content_catalog, encyclopedia_catalog } from '../../src/content/catalog.ts'
import { item_is_pet_food } from '../../src/content/item_resource_filters.ts'
import { copy_text, load_app_copy } from '../../src/i18n/copy.ts'
import { LOCALES } from '../../src/i18n/locale.ts'

const inventory_row = (item_type: string, category = 'resource'): ItemRow => ({
  id: item_type,
  item_type,
  category,
  name: item_type,
  level: 1,
  amount: 1,
  kiosk: 'kiosk',
})

test('inventory and sale selection share canonical pet foods without losing ordinary resource filters', () => {
  const foods = encyclopedia_catalog.item_filters.find(
    ({ group, id }) => group === 'resource' && id === 'pet_food'
  )!.item_types
  expect(foods.length).toBeGreaterThan(0)
  for (const item_type of foods) {
    const item = inventory_row(item_type)
    expect(item_is_pet_food(item_type)).toBe(true)
    expect(bag_item_matches(item, 'resources', 'pet_food')).toBe(true)
    expect(bag_item_matches(item, 'resources', 'all')).toBe(true)
    expect(bag_item_matches(item, 'resources', 'intermediary')).toBe(false)
    expect(bag_item_matches(item, 'equipment', 'pet_food')).toBe(false)
  }
  for (const { item_type, category } of content_catalog.items.filter(({ category }) => category === 'resource')) {
    expect(bag_item_matches(inventory_row(item_type, category), 'resources', 'pet_food')).toBe(
      foods.includes(item_type)
    )
  }
  expect(bag_item_matches(inventory_row('wheat'), 'resources', 'gatherable')).toBe(true)
  expect(bag_item_matches(inventory_row('wheat_flour'), 'resources', 'intermediary')).toBe(true)
  expect(bag_item_matches(inventory_row('unknown'), 'resources', 'raw')).toBe(true)
  expect(bag_item_matches(inventory_row('key', 'key'), 'resources', 'keys')).toBe(true)
  expect(bag_item_matches(inventory_row('rune', 'rune'), 'resources', 'runes')).toBe(true)
  expect(item_is_pet_food('unknown')).toBe(false)
})

test('shared inventory and sell controls expose localized pet food and its count in every locale', async () => {
  const food = encyclopedia_catalog.item_filters.find(({ group, id }) => group === 'resource' && id === 'pet_food')!
    .item_types[0]!
  for (const { code } of LOCALES) {
    const copy = await load_app_copy(code)
    const label = copy_text(copy.encyclopedia_page)('group_pet_food_resources')
    expect(label.length).toBeGreaterThan(0)
    const markup = renderToStaticMarkup(
      <InventoryResourceFilters
        category="resources"
        filter="pet_food"
        select={() => undefined}
        items={[{ item: inventory_row(food) }, { item: inventory_row('wheat') }]}
        copy={copy}
      />
    )
    expect(markup).toContain(label)
    expect(markup).toMatch(/aria-pressed="true"[^>]*>[^<]+<span[^>]*>1<\/span>/)
  }
})
