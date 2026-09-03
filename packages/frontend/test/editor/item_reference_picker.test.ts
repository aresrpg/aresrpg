// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { item_picker_facets, order_item_picker_rows } from '../../src/editor/ItemReferencePicker.tsx'
import type { ItemFilterRow } from '../../src/editor/content_list.ts'

test('the recipe item picker exposes the item editor facets with identical labels and sections', () => {
  const rows = [
    { kind: 'category', id: 'sword', count: 1, item_types: ['sword'] },
    { kind: 'resource', id: 'raw', count: 1, item_types: ['fuwa_wool'] },
    { kind: 'resource', id: 'gatherable', count: 1, item_types: ['wheat'] },
    { kind: 'resource', id: 'pet_food', count: 1, item_types: ['gilded_pet_food'] },
    { kind: 'craft', id: 'FARMER', count: 1, item_types: ['wheat_flour'] },
    { kind: 'gather', id: 'FARMER', count: 1, item_types: ['wheat'] },
    { kind: 'mob-family', id: 'fuwa', count: 1, item_types: ['fuwa_wool'] },
  ]

  expect(
    item_picker_facets(
      new Set(['sword', 'fuwa_wool', 'wheat', 'gilded_pet_food', 'wheat_flour']),
      rows as readonly ItemFilterRow[]
    )
  ).toEqual([
    { id: 'category:sword', label: 'Sword' },
    { id: 'resource:raw', label: 'Raw resources', section: 'Resources' },
    { id: 'resource:gatherable', label: 'Gatherable resources' },
    { id: 'resource:pet_food', label: 'Pet foods' },
    { id: 'craft:FARMER', label: 'Crafts FARMER', section: 'Recipe outputs' },
    { id: 'gather:FARMER', label: 'Gatherables FARMER', section: 'Gatherables' },
    { id: 'mob-family:fuwa', label: 'Fuwa', section: 'Mob resources' },
  ])
})

test('item picker rows order resources by level and then name', () => {
  const resources = [
    { item_type: 'late', name: 'Late', level: 20 },
    { item_type: 'zulu', name: 'Zulu', level: 5 },
    { item_type: 'alpha', name: 'Alpha', level: 5 },
  ]

  expect(order_item_picker_rows(resources).map(({ item_type }) => item_type)).toEqual(['alpha', 'zulu', 'late'])
})
