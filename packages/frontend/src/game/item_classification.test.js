// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import {
  COSMETICS_CATEGORY,
  COSMETIC_ITEM_TYPES,
  item_display_category,
  item_type_equip_slot,
} from './item_classification'
import { SHOP_AVAILABLE, shop } from '../test_helpers/shop_fixture.js'

const vanity_rows = shop.cosmetics ?? []

// MISSING-ARTIFACT (#117): seed/mainnet/shop.json is content-pipeline output, absent by design in this
// public repo — see test_helpers/shop_fixture.js.
describe('itemType classification — seed/mainnet cosmetic coverage', () => {
  test.skipIf(!SHOP_AVAILABLE)('the mapping keys exactly match every vanity itemType present in seed/mainnet', () => {
    const seeded_types = [...new Set(vanity_rows.map((row) => row.itemType))].sort()
    expect(seeded_types).toEqual(['cloak', 'hat', 'title'])
    expect(Object.keys(COSMETIC_ITEM_TYPES).sort()).toEqual(seeded_types)
  })

  test.skipIf(!SHOP_AVAILABLE)('every vanity row resolves to Cosmetics and its same-named real Move slot', () => {
    expect(vanity_rows).toHaveLength(shop._meta.populations.total)
    for (const row of vanity_rows) {
      expect(item_display_category(row), row.slug).toBe(COSMETICS_CATEGORY)
      expect(item_type_equip_slot(row), row.slug).toBe(row.itemType)
    }
  })

  test('accepts /v1 and inventory snake_case shapes without reclassifying ordinary gear', () => {
    expect(item_display_category({ item_type: 'cloak', category: 'cloak' })).toBe(COSMETICS_CATEGORY)
    expect(item_type_equip_slot({ item_type: 'cloak', item_category: 'cloak' })).toBe('cloak')
    expect(item_display_category({ item_type: 'iron_sword', item_category: 'sword' })).toBe('SWORD')
    expect(item_type_equip_slot({ item_type: 'iron_sword', item_category: 'sword' })).toBeNull()
  })
})
