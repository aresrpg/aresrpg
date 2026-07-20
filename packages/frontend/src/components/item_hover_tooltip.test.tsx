// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Regression guard: hovering a listed cosmetic cloak showed NO image — the hover fed ItemImage the
// on-chain template id (a 0x object id) with no cosmetic lookup, so it 404'd. to_detail_item must resolve
// the icon through the ONE marketplace home (cosmetic_icons.js via shop_item_icon), exactly like the shop.
import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'
import { configure_walrus_assets, item_icon_url } from '@aresrpg/sdk/jobs'

import { to_detail_item } from './item_hover_tooltip'

const asset_manifest = JSON.parse(readFileSync(new URL('../../public/asset_manifest.json', import.meta.url), 'utf8'))

const cloak = {
  id: '0xitem',
  template_id: '0x2521c902ae440a18c3cfd7ca5906b17d6ad6c3d754054c37d861c6b86938d80d',
  quantity: 1,
  stats_json: '{}',
  slot: '',
  name: 'Lorito Cloak (Sapphire)',
  description: '',
  rarity: 'common',
  category: 'Cloak',
  level: 0,
  damages_json: '[]',
  consumable_json: 'null',
  particle_trail_json: 'null',
  appearance: '',
  weapon_class: '',
  pet_power: 0,
  pet_stats_json: '{}',
} as const

const tt = ((_: unknown, __: unknown) => '') as never

describe('to_detail_item — cosmetic icon resolution', () => {
  test('a cosmetic cloak resolves its published cosmetic_icon URL, not the raw on-chain object id', () => {
    configure_walrus_assets(asset_manifest)
    const detail = to_detail_item(cloak, null, tt)
    // the icon identity is the authored cosmetic slug (resolved by name), never the 0x object id
    expect(detail.id).toBe('cape_lorito-chance')
    // and it points at the wearable `cosmetic_icon` quilt, byte-for-byte the shop's resolution
    expect(detail.image_url).toBe(item_icon_url('cape_lorito-chance', { asset_class: 'cosmetic_icon' }))
    expect(detail.image_url).toContain('cape_lorito-chance')
  })
})
