// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { get_trades } from '../src/reads/get_trades.ts'

test('trade manifests retain the seller kiosk for item and character claims', async () => {
  const graph = {
    read: async (query: string) => {
      if (query.includes('AND NOT')) return []
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
      if (query.includes('asset.id IN'))
        return [
          {
            asset: {
              properties: {
                id: '0xitem',
                name: 'Wool',
                level: 1,
                amount: 100,
                item_type: 'wool',
                category: 'resource',
              },
            },
            kinds: ['Item'],
            kiosk: '0xka',
          },
          {
            asset: { properties: { id: '0xcharacter', name: 'Aiden', level: 30, classe: 'senshi' } },
            kinds: ['Character'],
            kiosk: '0xkb',
          },
        ]
      return []
    },
    close: async () => undefined,
  }
  const [trade] = await get_trades(graph, { address: '0xa' })
  expect(trade?.caps_a[0]).toMatchObject({ object: '0xitem', kind: 'item', amount: 100, level: 1, kiosk: '0xka' })
  expect(trade?.caps_b[0]).toMatchObject({
    object: '0xcharacter',
    kind: 'character',
    classe: 'senshi',
    level: 30,
    kiosk: '0xkb',
  })
})

test('a terminal trade never renders partial consideration', async () => {
  const graph = {
    read: async (query: string) => {
      if (query.includes('AND NOT')) return []
      if (query.includes('MATCH (t:Trade'))
        return [
          {
            trade: {
              properties: {
                id: '0xtrade',
                a: '0xa',
                b: '0xb',
                version: 1,
                locked: true,
                sui_a: '0',
                sui_b: '0',
                caps_a: JSON.stringify(['0xmissing']),
                caps_b: '[]',
              },
            },
          },
        ]
      if (query.includes('asset.id IN')) return []
      return []
    },
  }
  await expect(get_trades(graph as never, { address: '0xa' })).rejects.toThrow('0xmissing')
})
