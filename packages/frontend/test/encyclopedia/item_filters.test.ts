// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { derive_item_filter_rows, filter_item_types } from '../../src/content/item_filters.ts'

const items = [
  { item_type: 'fixture_grain', category: 'resource' },
  { item_type: 'fixture_flour', category: 'resource' },
  { item_type: 'fixture_hat', category: 'hat' },
]
const item_types = items.map(({ item_type }) => item_type)
const facets = derive_item_filter_rows(
  items,
  [{ output_type: 'fixture_flour', inputs: { fixture_grain: 2 } }],
  () => 'FARMER',
  [{ mob_type: 'fixture_mob', loot: [{ item_type: 'fixture_hat' }] }],
  [{ kind: 'family', id: 'fixture_family', count: 1, mob_types: ['fixture_mob'] }],
  [{ world: 'fixture_world', cities: [], resources: [{ item_type: 'fixture_grain', biomes: [], cities: [] }] }]
)
const matching = (selected: Parameters<typeof filter_item_types>[2]): readonly string[] =>
  filter_item_types(item_types, facets, selected)

test('item facets derive category, crafting, location, and loot membership from supplied content', () => {
  expect(matching({ category: 'resource' })).toEqual(['fixture_grain', 'fixture_flour'])
  expect(matching({ resource: 'intermediary' })).toEqual(['fixture_flour'])
  expect(matching({ job: 'FARMER' })).toEqual(['fixture_flour'])
  expect(matching({ world: 'fixture_world' })).toEqual(['fixture_grain'])
  expect(matching({ family: 'fixture_family' })).toEqual(['fixture_hat'])
})

test('item facets intersect sections without inventing memberships', () => {
  expect(matching({ resource: 'intermediary', job: 'FARMER' })).toEqual(['fixture_flour'])
  expect(matching({ category: 'hat', family: 'fixture_family' })).toEqual(['fixture_hat'])
  expect(matching({ category: 'hat', resource: 'intermediary' })).toEqual([])
})
