// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { content_catalog } from '../../src/content/catalog.ts'
import { loot_box_odds, purchase_limit, shop_section } from '../../src/shop/model.ts'

describe('shop projection', () => {
  test('derives sections and loot odds from the shared seed catalog', () => {
    const box = content_catalog.item('pet_lootbox')!.item
    expect(shop_section(box)).toBe('pet_box')
    expect(loot_box_odds(box).reduce((sum, { percent }) => sum + percent, 0)).toBeCloseTo(100)
  })

  test('only stackable categories can exceed one purchase unit', () => {
    expect(purchase_limit({ balance_mist: 100n, category: 'hat', price_mist: 10n, stock: 8 })).toBe(1)
    expect(purchase_limit({ balance_mist: 100n, category: 'consumable', price_mist: 10n, stock: 8 })).toBe(8)
  })
})
