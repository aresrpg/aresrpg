// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Encyclopedia icon starvation: in production `virtual:item_catalog` resolves EMPTY (the seed name->icon map
// is private — vite.config.ts catalog_fallback_plugin), so every /v1 encyclopedia item row has NO `slug` and
// the icon key must come from what the row DOES carry. That key is `item_type`, the authored art slug the
// seed uploads `items/{item_type}.png` under; the earlier resolver mistook it for a generic family word (that
// is `category`) and derived the key from the display NAME instead, which is what put the placeholder flask
// on "Bag of Quartz" in the captured detail-page screenshot.
//
// PROVENANCE (live /v1 + assets.aresrpg.world, verified 2026-07-25 — full 1854-row census in
// item_classification.test.js): item_type unique on 1854/1854 rows; name-derivation diverges on 984 and
// serves 2 icons where item_type serves 515.
//   • "Bag of Quartz"  item_type "bag_quartz"  -> items/bag_quartz.png     HTTP 200
//     slugified name                              items/bag_of_quartz.png  HTTP 404
//   • "Timon"          item_type "pet_timon"   -> items/pet_timon.png      HTTP 200
//   • "Cinder Heart"   item_type "cinder_heart"-> items/cinder_heart.png   HTTP 200 (category "resource")
import { describe, expect, test } from 'bun:test'

import { encyclopedia_item_asset } from './encyclopedia_assets'

describe('encyclopedia_item_asset — the icon key is the live /v1 row itemType (no seed slug in prod)', () => {
  test('SPECIMEN: the list + detail icon is items/bag_quartz.png, never the name-derived bag_of_quartz', () => {
    const asset = encyclopedia_item_asset({ id: '0x97f1', item_type: 'bag_quartz', name: 'Bag of Quartz' })
    expect(asset.id).toBe('bag_quartz')
  })

  test('pet and resource rows key off the same field — no per-class branch survives', () => {
    expect(encyclopedia_item_asset({ id: '0xabc', item_type: 'pet_timon', name: 'Timon' }).id).toBe('pet_timon')
    expect(encyclopedia_item_asset({ id: '0xdef', item_type: 'cinder_heart', name: 'Cinder Heart' }).id).toBe(
      'cinder_heart'
    )
  })

  test('a mapped shop cosmetic alias still wins over the itemType (regression)', () => {
    const asset = encyclopedia_item_asset({
      id: '0x02',
      item_type: 'cape_lorito_agility',
      name: 'Lorito Cloak (Emerald)',
    })
    expect(asset.id).toBe('cape_lorito-agility')
  })

  test('an authored seed slug (dev/local, when the catalog IS bundled) still wins over the itemType', () => {
    const asset = encyclopedia_item_asset({
      id: '0x03',
      slug: 'authored_slug',
      item_type: 'chestplate',
      name: 'Whatever',
    })
    expect(asset.id).toBe('authored_slug')
  })

  test('a row with no itemType -> empty id: the honest category glyph, never a guess from the name', () => {
    expect(encyclopedia_item_asset({ id: '0x04' }).id).toBe('')
    expect(encyclopedia_item_asset({ id: '0x05', name: 'Bag of Quartz' }).id).toBe('')
  })
})
