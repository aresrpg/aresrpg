// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Encyclopedia icon starvation (issue #160): in production `virtual:item_catalog` resolves EMPTY (the seed
// name->icon map is private — vite.config.ts catalog_fallback_plugin), so every /v1 encyclopedia item row has
// NO `slug`. The old resolver keyed the icon off that absent slug and degraded straight to '' (the glyph),
// which is why the owner saw "placeholder icons everywhere". The icon must instead derive from what the /v1
// row DOES carry: `item_type` (a unique `pet_*` slug for pets, else the generic family word) + `name`.
//
// PROVENANCE (live CDN + /v1, verified 2026-07-21):
//   • "Timon"        item_type "pet_timon"  -> items/pet_timon.png      HTTP 200 (pet: item_type IS the slug)
//   • "Cinder Heart" item_type "resource"   -> items/cinder_heart.png   HTTP 200 (slugified display name)
//   • "Cinder Cuirass" item_type "chestplate" -> items/cinder_cuirass.png HTTP 200
//   • generic family words items/resource.png, items/chestplate.png     HTTP 404 (never the icon)
import { describe, expect, test } from 'bun:test'

import { encyclopedia_item_asset } from './encyclopedia_assets'

describe('encyclopedia_item_asset — derives the icon slug from the live /v1 row (no seed slug in prod)', () => {
  test('pet: the unique pet_* item_type is the icon slug (Timon -> pet_timon)', () => {
    const asset = encyclopedia_item_asset({ id: '0xabc', item_type: 'pet_timon', name: 'Timon' })
    expect(asset.id).toBe('pet_timon')
  })

  test('gear/resource: the slugified display name is the icon slug (Cinder Heart -> cinder_heart)', () => {
    const asset = encyclopedia_item_asset({ id: '0xdef', item_type: 'resource', name: 'Cinder Heart' })
    expect(asset.id).toBe('cinder_heart')
  })

  test('gear with a generic family item_type: still slugifies the name (Cinder Cuirass -> cinder_cuirass)', () => {
    const asset = encyclopedia_item_asset({ id: '0x01', item_type: 'chestplate', name: 'Cinder Cuirass' })
    expect(asset.id).toBe('cinder_cuirass')
  })

  test('a mapped shop cosmetic still wins over the name derivation (regression)', () => {
    const asset = encyclopedia_item_asset({ id: '0x02', item_type: 'cloak', name: 'Lorito Cloak (Emerald)' })
    expect(asset.id).toBe('cape_lorito-agility')
  })

  test('an authored seed slug (dev/local, when the catalog IS bundled) still wins over the derivation', () => {
    const asset = encyclopedia_item_asset({
      id: '0x03',
      slug: 'authored_slug',
      item_type: 'chestplate',
      name: 'Whatever',
    })
    expect(asset.id).toBe('authored_slug')
  })

  test('no name and no slug -> empty id so ItemImage renders the honest category glyph', () => {
    const asset = encyclopedia_item_asset({ id: '0x04', item_type: 'chestplate' })
    expect(asset.id).toBe('')
  })
})
