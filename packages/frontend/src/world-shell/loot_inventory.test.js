// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Issue #265: the successful loot-settle outcome must become an inventory reducer INPUT immediately. The
// receipt-created row then survives an indexer-lagged snapshot until that snapshot proves the same id itself.

import { describe, expect, it } from 'bun:test'
import { reduce_sui_data } from '@aresrpg/inventory/reduce'

import { settled_loot_input, settled_loot_rows } from './loot_inventory.js'

const start = () => ({ characters: [], items: [{ id: '0xold' }], settled_item_floor: {} })

const settlement = {
  receipt: {
    events: [
      {
        type: '0xares::item::ItemMinted',
        parsedJson: { item: '0xloot', template: '0xtemplate', item_type: 'razkin_hide', amount: '2' },
      },
    ],
  },
  kiosk_id: '0xkiosk',
  kiosk_cap_id: '0xcap',
}

const templates = new Map([
  ['0xtemplate', { name: 'Razkin Hide', item_type: 'razkin_hide', category: 'RESOURCE', level: 10 }],
])

describe('settle → inventory reducer seam', () => {
  it('exposes the exact receipt-created rows for the victory-card instance join', () => {
    expect(settled_loot_rows(settlement, templates)).toEqual([
      expect.objectContaining({ id: '0xloot', template_id: '0xtemplate', item_type: 'razkin_hide', amount: 2 }),
    ])
  })

  it('folds ItemMinted receipt truth into the bag without a refresh', () => {
    const input = settled_loot_input(settlement, templates)
    const after = reduce_sui_data(start(), input)

    expect(input.kind).toBe('receipt_patch')
    expect(input.op).toBe('settled_loot')
    expect(after.items).toEqual([
      { id: '0xold' },
      {
        id: '0xloot',
        template_id: '0xtemplate',
        name: 'Razkin Hide',
        item_category: 'resource',
        item_set: '',
        item_type: 'razkin_hide',
        icon_slug: 'razkin_hide',
        level: 0,
        amount: 2,
        kiosk_id: '0xkiosk',
        kiosk_cap_id: '0xcap',
        listed: false,
        stackable: true,
      },
    ])
  })

  it('holds the receipt-proven row across a lagged snapshot, then yields to the caught-up row', () => {
    const settled = reduce_sui_data(start(), settled_loot_input(settlement, templates))
    const lagged = reduce_sui_data(settled, { kind: 'snapshot', items: [{ id: '0xold' }] })
    expect(lagged.items.map((item) => item.id)).toEqual(['0xold', '0xloot'])

    const authoritative = { id: '0xloot', name: 'Razkin Hide', amount: 2, indexed: true }
    const caught_up = reduce_sui_data(lagged, { kind: 'snapshot', items: [{ id: '0xold' }, authoritative] })
    expect(caught_up.items).toEqual([{ id: '0xold' }, authoritative])
    expect(caught_up.settled_item_floor).toEqual({})
  })
})
