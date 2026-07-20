// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { resolve_box_template } from './lootbox_util.js'

test('double-click opening a just-bought optimistic row keeps its exact loot-box template', async () => {
  // Exact shape hydrated by pages/shop.tsx after a successful purchase.
  const optimistic_box = {
    id: '0xbox',
    name: 'Mystery Pet Box',
    item_type: 'pet_lootbox',
    template_id: '0xlive-gacha-template',
    level: 1,
    item_category: 'consumable',
    item_set: '',
    amount: 1,
    kiosk_id: '0xkiosk',
    kiosk_cap_id: '0xcap',
  }

  const exact_templates = new Map([
    [optimistic_box.template_id, { id: optimistic_box.template_id, item_type: optimistic_box.item_type }],
  ])
  const lossy_slug_templates = new Map([
    [optimistic_box.item_type, { id: '0xstale-effectless-template', item_type: optimistic_box.item_type }],
  ])

  expect(resolve_box_template(optimistic_box, exact_templates, lossy_slug_templates)?.id).toBe(
    optimistic_box.template_id
  )
})

test('an old row without template_id retains the item_type fallback', () => {
  const fallback = { id: '0xlegacy-box-template', item_type: 'pet_lootbox' }
  expect(resolve_box_template({ item_type: 'pet_lootbox' }, new Map(), new Map([['pet_lootbox', fallback]]))).toBe(
    fallback
  )
})
