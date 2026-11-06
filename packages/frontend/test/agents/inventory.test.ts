// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { AgentInventory } from '@aresrpg/sdk/agent-inventory'

import { inventory_offer } from '../../src/agents/AgentInventoryPanel.tsx'

const metadata = { name: 'Item', item_type: 'wool', category: 'resource', level: 1, amount: 2 }
const inventory: AgentInventory = {
  positions: [],
  proceeds: [],
  owned: [],
  other_kiosk_objects: [],
  sui_mist: '0',
  kares_mist: '0',
  items: [
    { item: { ...metadata, id: 'available', kiosk: 'first', version: '1' }, status: 'available' },
    {
      item: { ...metadata, id: 'equipped', kiosk: 'second', version: '2' },
      status: 'equipped',
      character_id: 'character',
      slot: 'hat',
    },
    { item: { ...metadata, id: 'listed', kiosk: 'third', version: '3' }, status: 'listed' },
  ],
}
const state = { inventory, selected: ['available', 'equipped', 'listed'], sui: '', kares: '', reserve: '0.05' }
test('selection preserves exact item custody and excludes listed assets without demanding token amounts', () => {
  expect(inventory_offer(state, 'human')).toEqual({
    kind: 'asset_offer',
    recipient: 'human',
    items: [
      {
        item_id: 'available',
        kiosk: 'first',
        version: '1',
        direct: undefined,
        character_id: undefined,
        slot: undefined,
      },
      { item_id: 'equipped', kiosk: 'second', version: '2', direct: undefined, character_id: 'character', slot: 'hat' },
    ],
    sui_mist: '0',
    kares_mist: '0',
    reserve_mist: '50000000',
  })
})
test('exact token amounts and an explicit zero reserve are retained; invalid or empty choices never prepare', () => {
  expect(inventory_offer({ ...state, selected: [], sui: '0.000000001', kares: '2.5', reserve: '0' }, 'human')).toEqual({
    kind: 'asset_offer',
    recipient: 'human',
    items: [],
    sui_mist: '1',
    kares_mist: '2500000000',
    reserve_mist: '0',
  })
  expect(inventory_offer({ ...state, selected: [] }, 'human')).toBeNull()
  for (const sui of ['-1', '1e3', '0.0000000001']) expect(inventory_offer({ ...state, sui }, 'human')).toBeNull()
})
