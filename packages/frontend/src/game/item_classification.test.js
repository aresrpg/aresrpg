// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import {
  COSMETICS_CATEGORY,
  COSMETIC_ITEM_TYPES,
  chain_icon_slug,
  group_by_stack_identity,
  item_display_category,
  item_type_equip_slot,
  slugify_name,
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

// chain_icon_slug (issue #160): production ships an EMPTY seed catalog, so the icon must derive from the live
// /v1 row's own fields. Fixtures curl-verified 200 on the live icon quilts 2026-07-21 (see encyclopedia_assets.test.ts).
describe('chain_icon_slug — the icon key from a live /v1 row when no seed slug is bundled', () => {
  test('a pet carries its UNIQUE slug as item_type (Timon -> pet_timon)', () => {
    expect(chain_icon_slug({ item_type: 'pet_timon', name: 'Timon' })).toBe('pet_timon')
  })

  test('a pet lootbox keeps its pet_* item_type (item_type is the art slug, not the family word)', () => {
    expect(chain_icon_slug({ item_type: 'pet_lootbox', name: 'Pet Box' })).toBe('pet_lootbox')
  })

  test('gear/resource with a generic family item_type keys off the slugified name (Cinder Heart -> cinder_heart)', () => {
    expect(chain_icon_slug({ item_type: 'resource', name: 'Cinder Heart' })).toBe('cinder_heart')
    expect(chain_icon_slug({ item_type: 'chestplate', name: 'Cinder Cuirass' })).toBe('cinder_cuirass')
  })

  test('the bare generic word "pet" (no underscore) is NOT a unique slug -> falls to the slugified name', () => {
    expect(chain_icon_slug({ item_type: 'pet', name: 'Wild Fennec' })).toBe('wild_fennec')
  })

  test('returns null when neither a pet item_type nor a name is derivable (caller keeps its glyph fallback)', () => {
    expect(chain_icon_slug({ item_type: 'chestplate' })).toBeNull()
    expect(chain_icon_slug(null)).toBeNull()
  })
})

describe('slugify_name — lowercase, diacritic-stripped, non-alphanumeric runs -> single underscore', () => {
  test('collapses spaces and punctuation and trims the ends', () => {
    expect(slugify_name('Void Eye Talisman')).toBe('void_eye_talisman')
    expect(slugify_name("Duke's Regalia")).toBe('duke_s_regalia')
    expect(slugify_name('  Frost — Shard  ')).toBe('frost_shard')
  })

  test('strips diacritics so accented names still resolve to their ASCII icon key', () => {
    expect(slugify_name('Élan Café')).toBe('elan_cafe')
  })

  test('an empty/nullish name is the empty string (the caller treats it as no-slug)', () => {
    expect(slugify_name('')).toBe('')
    expect(slugify_name(null)).toBe('')
  })
})

// THE ONE GROUPING HOME (issue #10): the HUD bag grid (inventory-equip.js's group_stackable, keyed on `amount`)
// and the marketplace SELL grid (inventory_panel.tsx's aggregate_listable, keyed on `quantity`) used to carry
// two independent copies of this exact mechanism that could disagree. Pins the canonical cases from BOTH old
// homes' behaviors against the one surviving implementation.
describe('group_by_stack_identity — THE one grouping home (marketplace + HUD inventory, issue #10)', () => {
  test('merges same-template_id rows and sums the named amount field, keeping the first-seen row identity', () => {
    const rows = [
      { id: '0xa', template_id: '0xtpl', amount: 3 },
      { id: '0xb', template_id: '0xtpl', amount: 2 },
    ]
    const grouped = group_by_stack_identity(rows, 'amount')
    expect(grouped).toHaveLength(1)
    expect(grouped[0]).toMatchObject({ id: '0xa', template_id: '0xtpl', amount: 5 })
  })

  test('is field-name generic — the marketplace SELL grid sums `quantity`, the HUD bag sums `amount`', () => {
    const rows = [
      { id: '0xa', template_id: '0xtpl', quantity: 10 },
      { id: '0xb', template_id: '0xtpl', quantity: 5 },
    ]
    const grouped = group_by_stack_identity(rows, 'quantity')
    expect(grouped).toHaveLength(1)
    expect(grouped[0].quantity).toBe(15)
  })

  test('falls back to item_type ONLY for rows without a template_id (bare fixtures) — two such rows still merge', () => {
    const rows = [
      { id: '0xa', item_type: 'small_potion', amount: 3 },
      { id: '0xb', item_type: 'small_potion', amount: 2 },
    ]
    const grouped = group_by_stack_identity(rows, 'amount')
    expect(grouped).toHaveLength(1)
    expect(grouped[0].amount).toBe(5)
  })

  test('the petbox case: two DIFFERENT template_ids sharing the same item_type never merge (07-20 fix)', () => {
    const old_lineage = { id: '0xold-box', item_type: 'normal_pet_lootbox', template_id: '0xtpl-old', amount: 1 }
    const new_lineage = { id: '0xnew-box', item_type: 'normal_pet_lootbox', template_id: '0xtpl-new', amount: 1 }
    const grouped = group_by_stack_identity([old_lineage, new_lineage], 'amount')
    expect(grouped).toHaveLength(2)
    expect(grouped.find((row) => row.id === '0xold-box')).toMatchObject({ template_id: '0xtpl-old', amount: 1 })
    expect(grouped.find((row) => row.id === '0xnew-box')).toMatchObject({ template_id: '0xtpl-new', amount: 1 })
  })

  test('floors a non-positive/missing count to 1 so a malformed row never vanishes from its owner\'s view', () => {
    const grouped = group_by_stack_identity([{ id: '0xa', template_id: '0xtpl', amount: 0 }], 'amount')
    expect(grouped[0].amount).toBe(1)
  })
})
