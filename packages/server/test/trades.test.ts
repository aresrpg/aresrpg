// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { get_trade } from '../src/reads/get_trades.ts'

test('trade manifests retain the seller kiosk for item and character claims', async () => {
  const graph = {
    read: async (query: string, params?: Readonly<Record<string, unknown>>) => {
      if (query.includes('MATCH (t:Trade'))
        return [
          {
            trade: {
              properties: {
                id: '0xtrade',
                a: '0xa',
                b: '0xb',
                version: 1,
                accept_a: true,
                accept_b: true,
                locked: true,
                sui_a: '0',
                sui_b: '0',
                caps_a: JSON.stringify(['0xitem']),
                caps_b: JSON.stringify(['0xcharacter']),
              },
            },
          },
        ]
      const character = params?.id === '0xcharacter'
      return [
        {
          asset: {
            properties: character
              ? { id: '0xcharacter', name: 'Aiden', classe: 'senshi' }
              : { id: '0xitem', name: 'Wool', item_type: 'wool', category: 'resource' },
          },
          kinds: [character ? 'Character' : 'Item'],
          kiosk: character ? '0xkb' : '0xka',
        },
      ]
    },
    close: async () => undefined,
  }
  const trade = await get_trade(graph, { trade_id: '0xtrade' })
  expect(trade?.caps_a[0]).toMatchObject({ object: '0xitem', kind: 'item', kiosk: '0xka' })
  expect(trade?.caps_b[0]).toMatchObject({ object: '0xcharacter', kind: 'character', kiosk: '0xkb' })
})
