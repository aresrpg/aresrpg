// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import type { ItemRow } from '@aresrpg/protocol'

import { journey_ingredients } from '../../src/journey/ingredients.ts'
import { encumbered_asset_ids } from '../../src/inventory_stacks.ts'
import { initial_app_state } from '../../src/store.ts'
import { quest_changes } from '../../src/journey/facts.ts'

const inventory: ItemRow[] = [
  { id: 'listed', item_type: 'gnawed_branch', name: 'branch', category: 'resource', level: 1, amount: 3, kiosk: 'a' },
  { id: 'traded', item_type: 'gnawed_branch', name: 'branch', category: 'resource', level: 1, amount: 4, kiosk: 'a' },
  { id: 'other', item_type: 'gnawed_branch', name: 'branch', category: 'resource', level: 1, amount: 5, kiosk: 'b' },
  { id: 'free', item_type: 'gnawed_branch', name: 'branch', category: 'resource', level: 1, amount: 1, kiosk: 'a' },
]

test('preparation excludes listed, traded and other-kiosk ingredients', () => {
  const blocked = encumbered_asset_ids(
    [{ id: 'listed' }] as never,
    [{ caps_a: [{ object: 'traded' }], caps_b: [] }] as never
  )
  expect(journey_ingredients('old_hoe', inventory, blocked, 'a')[0]).toEqual({
    item: 'gnawed_branch',
    need: 3,
    have: 1,
  })
  expect(journey_ingredients('old_hoe', inventory, blocked, 'b')[0]?.have).toBe(5)
  expect(journey_ingredients('old_hoe', inventory, blocked, null)[0]?.have).toBe(0)
})

test('unlisting or changing the crafting character rechecks preparation without an inventory arrival', () => {
  const base = initial_app_state({ quality: 'medium', music_enabled: true, render_distance: null })
  const state = {
    ...base,
    journey: { ...base.journey, ready: true, completed: ['welcome', 'map_travel', 'first_hunt'] },
    session: {
      ...base.session,
      roster_loaded: true,
      selected_character_id: 'hero',
      characters: [
        { id: 'hero', kiosk: 'a', equipment: [] },
        { id: 'crafter', kiosk: 'b', equipment: [] },
      ] as never,
      inventory: [
        inventory[0]!,
        inventory[2]!,
        { ...inventory[0]!, id: 'scrap-a', item_type: 'salvaged_scrap', amount: 2 },
        { ...inventory[2]!, id: 'scrap-b', item_type: 'salvaged_scrap', amount: 2 },
      ],
    },
    marketplace: { ...base.marketplace, own_listings: [{ id: 'listed' }] as never },
  }
  expect(quest_changes(state, base)).not.toContain('hoe_materials')
  const unlisted = { ...state, marketplace: { ...state.marketplace, own_listings: [] } }
  expect(quest_changes(unlisted, state)).toContain('hoe_materials')
  const traded = {
    ...unlisted,
    trade: { ...unlisted.trade, rows: [{ caps_a: [{ object: 'listed' }], caps_b: [] }] as never },
  }
  const released = { ...traded, trade: { ...traded.trade, rows: [] } }
  expect(quest_changes(released, traded)).toContain('hoe_materials')
  const selected = { ...state, session: { ...state.session, selected_character_id: 'crafter' } }
  expect(quest_changes(selected, state)).toContain('hoe_materials')
  const configured = { ...state, settings: { ...state.settings, always_craft_from_character_id: 'crafter' } }
  expect(quest_changes(configured, state)).toContain('hoe_materials')
})
