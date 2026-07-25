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

// ── SPECIMEN: "Bag of Quartz" (issue: iconless on the encyclopedia detail) ────────────────────────────
// CHAIN TRUTH (live /v1 encyclopedia census, 2026-07-25 — 1854 rows): `item_type` is the AUTHORED, UNIQUE
// art slug on 1854/1854 rows (0 duplicates); the GENERIC family word is `category` (30 values), which this
// resolver used to confuse with item_type. Deriving the key from the display name instead of item_type
// diverges on 984/1854 rows, of which the name-derived path serves 2 icons and item_type serves 515
// (HEAD-probed against assets.aresrpg.world; the rest is genuinely unpublished art — issue #764's row).
//   • "Bag of Quartz"     item_type `bag_quartz`       -> items/bag_quartz.png       HTTP 200
//     slugified name                `bag_of_quartz`    -> items/bag_of_quartz.png    HTTP 404
//   • "Bag of Nightcaps"  item_type `bag_nightcap`     · "Aftershock" item_type `riftsunder_blade`
//     — the two cases #160 built a runtime name->slug map for; item_type carries them natively.
describe('chain_icon_slug — the icon key IS the itemType (specimen: Bag of Quartz)', () => {
  test('the specimen resolves to its itemType, never the slugified display name', () => {
    expect(chain_icon_slug({ item_type: 'bag_quartz', name: 'Bag of Quartz' })).toBe('bag_quartz')
  })

  test('the name-derived slugs #160 papered over with a runtime map come free from itemType', () => {
    expect(chain_icon_slug({ item_type: 'bag_nightcap', name: 'Bag of Nightcaps' })).toBe('bag_nightcap')
    expect(chain_icon_slug({ item_type: 'riftsunder_blade', name: 'Aftershock' })).toBe('riftsunder_blade')
  })

  test('pets need no special case any more — their itemType is the key like every other row', () => {
    expect(chain_icon_slug({ item_type: 'pet_timon', name: 'Timon' })).toBe('pet_timon')
  })

  test('no itemType -> null; the caller keeps its glyph fallback (never a name guess)', () => {
    expect(chain_icon_slug({ name: 'Bag of Quartz' })).toBeNull()
    expect(chain_icon_slug(null)).toBeNull()
  })
})
