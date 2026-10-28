// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { BrowsePanel } from '../../src/marketplace/BrowsePanel.tsx'
import { content_catalog } from '../../src/content/catalog.ts'
import { dispatch_app, initialize_app_store, read_app_state } from '../../src/store.ts'
import { render_english } from '../i18n/render.ts'

for (const [item_type, effect] of [
  ['croissant', 'Restores 10 HP'],
  ['potion_of_thebes', 'Travels to the City of Thebes'],
  ['potion_of_the_ruins', 'Travels to the City of The Ruins'],
  ['potion_of_fuwage', 'Travels to the City of Fuwage'],
  ['recall_potion', 'Returns to the world portal'],
  ['scroll_of_oblivion', 'Reset spell points'],
  ['scroll_of_rebirth', 'Reset stat points'],
  ['food_crate', 'Opens a random reward'],
] as const)
  test(`marketplace shows the authored effect for ${item_type} without requiring an offer`, () => {
    initialize_app_store({ quality: 'medium', music_enabled: false, render_distance: null })
    const { item } = content_catalog.item(item_type)!
    dispatch_app({ type: 'market/group_selected', group: 'CONSUMABLE', category: 'consumable', item_type })
    dispatch_app({
      type: 'server/packet',
      packet: {
        type: 'packet/market_types',
        observation: read_app_state().marketplace.observation!,
        items: [{ item_type, name: item.name, category: 'consumable', level: item.level }],
      },
    })
    const markup = render_english(<BrowsePanel text={(key) => key} />)
    expect(markup).toContain(item.name)
    expect(markup).toContain(effect)
  })
