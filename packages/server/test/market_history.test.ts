// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { get_market_history } from '../src/reads/get_market_history.ts'

const sale = (side: 'sold' | 'bought', ts_ms: number, price_mist: string): string =>
  `1:2:3|${JSON.stringify({
    object: '0xitem',
    kind: 'item',
    name: 'Aberrant Edge',
    item_type: 'aberrant_edge',
    amount: 1,
    price_mist,
    exclusive: false,
    ts_ms,
    side,
    counterparty: '0xother',
  })}`

describe('market history projection', () => {
  test('keeps seller rows, computes the trailing window, and carries live kiosk proceeds', async () => {
    const now_ms = 4_000_000_000
    const result = await get_market_history(
      {
        read: async () => [{ kiosk: '0xkiosk', amount_mist: '77' }],
        close: async () => undefined,
      },
      { sales_history: async () => [sale('sold', now_ms - 10, '12'), sale('bought', now_ms - 5, '99')] } as never,
      { address: '0xme', now_ms }
    )
    expect(result.sales).toHaveLength(1)
    expect(result.sales[0]).toMatchObject({ id: '1:2:3', name: 'Aberrant Edge' })
    expect(result.revenue_30d_mist).toBe('12')
    expect(result.total).toBe(1)
    expect(result.profits).toEqual([{ kiosk: '0xkiosk', amount_mist: '77' }])
  })

  test('a corrupt retained row fails loudly instead of truncating money history', async () => {
    expect(
      get_market_history(
        { read: async () => [], close: async () => undefined },
        { sales_history: async () => ['broken'] } as never,
        { address: '0xme' }
      )
    ).rejects.toThrow('coordinate separator')
  })
})
