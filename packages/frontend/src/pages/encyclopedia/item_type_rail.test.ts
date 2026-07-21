// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST (issue #31): before this file, every cosmetic item's category was the collapsed COSMETICS
// bucket — nothing distinguished a hat from a cloak from a title, so the sub-category rail had exactly one
// candidate bucket (itself) and stayed hidden, and every cosmetic card's type label read the same generic
// "COSMETICS" string. These assertions fail against the naive `item.category` reading (proving the bug is
// real) and pass against item_type_of/item_type_buckets (proving the fix).
import { describe, expect, test } from 'bun:test'

import { item_type_of, item_type_label_key, item_type_buckets } from './item_type_rail'

describe('item_type_of — the per-item type used by both the card label and the rail bucket', () => {
  test('a cosmetic resolves to its SPECIFIC equip slot, not the collapsed COSMETICS bucket', () => {
    expect(item_type_of({ category: 'COSMETICS', item_type: 'hat' })).toBe('HAT')
    expect(item_type_of({ category: 'COSMETICS', item_type: 'cloak' })).toBe('CLOAK')
    expect(item_type_of({ category: 'COSMETICS', item_type: 'title' })).toBe('TITLE')
  })

  test('a non-cosmetic item is untouched — its own category, never overridden by item_type', () => {
    expect(item_type_of({ category: 'BOW', item_type: 'bow' })).toBe('BOW')
    expect(item_type_of({ category: 'RESOURCE', item_type: undefined })).toBe('RESOURCE')
  })
})

describe('item_type_label_key — the i18n key both the grid card and the rail read', () => {
  test('a HAT cosmetic keys off entity.category.hat, not entity.category.cosmetics', () => {
    expect(item_type_label_key({ category: 'COSMETICS', item_type: 'hat' })).toBe('entity.category.hat')
  })
})

describe('item_type_buckets — the third-column projection', () => {
  test('a cosmetics group with hats, cloaks, AND titles present divides into three real buckets', () => {
    const items = [
      { category: 'COSMETICS', item_type: 'hat' },
      { category: 'COSMETICS', item_type: 'hat' },
      { category: 'COSMETICS', item_type: 'cloak' },
      { category: 'COSMETICS', item_type: 'title' },
    ]
    expect(item_type_buckets(items)).toEqual([
      { type: 'HAT', count: 2 },
      { type: 'CLOAK', count: 1 },
      { type: 'TITLE', count: 1 },
    ])
  })

  test('a group whose items share one type reduces to ONE bucket — the caller hides the redundant rail', () => {
    const items = [
      { category: 'COSMETICS', item_type: 'title' },
      { category: 'COSMETICS', item_type: 'title' },
    ]
    expect(item_type_buckets(items)).toEqual([{ type: 'TITLE', count: 2 }])
  })

  test('an empty item list projects to zero buckets', () => {
    expect(item_type_buckets([])).toEqual([])
  })
})
