// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { encyclopedia_catalog } from '../../src/content/catalog.ts'
import { filter_item_types } from '../../src/content/item_filters.ts'

const item_types = encyclopedia_catalog.items.map(({ item_type }) => item_type)
const matching = (selected: Parameters<typeof filter_item_types>[2]): readonly string[] =>
  filter_item_types(item_types, encyclopedia_catalog.item_filters, selected)

test('item facets derive category, resource, crafting, location, and loot-family membership', () => {
  encyclopedia_catalog.item_filters.forEach(({ item_types: members }) =>
    members.forEach((item_type) => expect(item_types).toContain(item_type))
  )
  expect(matching({ category: 'resource' })).toContain('wheat')
  expect(matching({ resource: 'gatherable' })).toContain('wheat')
  expect(matching({ resource: 'intermediary' })).toContain('wheat_flour')
  expect(matching({ resource: 'pet_food' })).toHaveLength(11)
  expect(matching({ resource: 'pet_food' })).toContain('gilded_pet_food')
  expect(matching({ resource: 'intermediary' })).not.toContain('gilded_pet_food')
  expect(matching({ job: 'FARMER' })).toContain('wheat_flour')
  expect(matching({ world: 'nauvis' })).toContain('wheat')
  expect(matching({ world: 'nauvis:plains' })).toContain('wheat')
  expect(matching({ world: 'nauvis:thebes' })).toContain('wheat')
  expect(matching({ family: 'fuwa' })).toContain('fuwa_wool')
})

test('item facets intersect distinct sections without inventing alternate memberships', () => {
  const farmer_intermediaries = matching({ resource: 'intermediary', job: 'FARMER' })
  expect(farmer_intermediaries).toContain('wheat_flour')
  farmer_intermediaries.forEach((item_type) => {
    expect(matching({ resource: 'intermediary' })).toContain(item_type)
    expect(matching({ job: 'FARMER' })).toContain(item_type)
  })
  expect(matching({ category: 'hat', family: 'fuwa' })).toContain('coiffe_fuwa__white')
  expect(matching({ category: 'hat', resource: 'raw' })).toEqual([])
})
