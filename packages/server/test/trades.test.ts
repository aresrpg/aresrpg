// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { get_trades } from '../src/reads/get_trades.ts'

test('trade manifests retain each item seller kiosk for settlement', async () => {
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
                phase: 'settling',
                offer_revision: 1,
                accept_a: true,
                accept_b: true,
                sui_a: '0',
                sui_b: '0',
                caps_a: JSON.stringify(['0xitem']),
                caps_b: JSON.stringify(['0xore']),
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
            kiosk: '0xka',
          },
          {
            asset: {
              properties: {
                id: '0xore',
                name: 'Ore',
                level: 2,
                amount: 10,
                item_type: 'ore',
                category: 'resource',
              },
            },
            kiosk: '0xkb',
          },
        ]
      return []
    },
    close: async () => undefined,
  }
  const [trade] = await get_trades(graph, { address: '0xa' })
  expect(trade?.caps_a[0]).toMatchObject({ object: '0xitem', amount: 100, level: 1, kiosk: '0xka' })
  expect(trade?.caps_b[0]).toMatchObject({ object: '0xore', amount: 10, level: 2, kiosk: '0xkb' })
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
                phase: 'settling',
                offer_revision: 1,
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

test('either funded side makes a trade essential after refresh', async () => {
  const queries: string[] = []
  const graph = {
    read: async (query: string) => {
      queries.push(query)
      return []
    },
  }
  await get_trades(graph as never, { address: '0xa' })
  expect(queries[0]).toContain("t.sui_a <> '0' OR t.sui_b <> '0'")
  expect(queries[0]).toContain("t.caps_a <> '[]' OR t.caps_b <> '[]'")
})

test('the request inbox exposes only the newest incoming invitation and outgoing request', async () => {
  const queries: string[] = []
  const request = (id: string, a: string, b: string) => ({
    trade: {
      properties: {
        id,
        a,
        b,
        phase: 'requested',
        offer_revision: 0,
        accept_a: false,
        accept_b: false,
        sui_a: '0',
        sui_b: '0',
        caps_a: '[]',
        caps_b: '[]',
      },
    },
  })
  const graph = {
    read: async (query: string) => {
      queries.push(query)
      if (!query.includes('AND NOT')) return []
      return query.includes('t.b = $address') ? [request('0xin', '0xb', '0xa')] : [request('0xout', '0xa', '0xb')]
    },
  }
  const rows = await get_trades(graph as never, { address: '0xa' })
  expect(rows.map(({ id }) => id)).toEqual(['0xin', '0xout'])
  expect(queries.filter((query) => query.includes('AND NOT'))).toHaveLength(2)
  expect(queries.filter((query) => query.includes('AND NOT')).every((query) => query.includes('LIMIT 1'))).toBeTrue()
})
