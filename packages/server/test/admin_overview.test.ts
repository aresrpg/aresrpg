// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { get_admin_overview, get_admin_shop_sales } from '../src/reads/get_admin_overview.ts'

const DAY = 86_400_000
const now_ms = 40 * DAY
const sale = JSON.stringify({
  coordinate: '39:1:2',
  checkpoint: 39,
  tx_digest: 'digest',
  timestamp_ms: now_ms - 1,
  sale_id: '0xsale',
  buyer: '0xbuyer',
  item_type: 'potion',
  quantity: 2,
  unit_price_mist: '50',
  total_mist: '100',
  remaining_supply: '8',
})

test('overview derives exact active and money totals from the selected tier', async () => {
  const money = (ts_ms: number, values: Readonly<Record<string, string>>) =>
    JSON.stringify({
      ts_ms,
      shop_mist: '0',
      shop_orders: '0',
      item_royalty_mist: '0',
      character_royalty_mist: '0',
      character_creation_mist: '0',
      kolizeum_mist: '0',
      ...values,
    })
  const graph = { read: async () => [{ total: 4 }] }
  const bus = {
    analytics_hashes: async (keys: readonly string[]) =>
      keys.map((key) => {
        if (key === 'analytics:transactions:all') return { '39': '12' }
        if (key === 'analytics:gas:all') return { '39': '250000000' }
        if (key === `analytics:gas:day:${now_ms}`) return { '40': '100000000' }
        if (key !== `analytics:money:day:${now_ms}`) return {}
        return {
          legacy: JSON.stringify({
            ts_ms: now_ms - 1,
            shop_mist: '0',
            shop_orders: '0',
            item_royalty_mist: '0',
            character_royalty_mist: '0',
          }),
          royalty: money(now_ms - 1, { shop_mist: '20', character_royalty_mist: '3' }),
          shop: money(now_ms - 1, {
            shop_mist: '100',
            shop_orders: '2',
            item_royalty_mist: '10',
            character_royalty_mist: '5',
            character_creation_mist: '1000',
            kolizeum_mist: '20',
          }),
        }
      }),
    analytics_counts: async (keys: readonly string[]) => keys.map((key) => (key.endsWith(String(now_ms)) ? 2 : 0)),
    analytics_sums: async (keys: readonly string[]) => keys.map((key) => (key.endsWith(String(now_ms)) ? 5 : 0)),
    analytics_cumulative_counts: async (_key: string, maxes: readonly number[]) => [...maxes.map(() => 3), 3],
    analytics_sets: async (keys: readonly string[]) =>
      keys.map((key) => (key.endsWith(String(now_ms)) ? ['0xa', '0xb'] : ['0xa'])),
    shop_sales: async () => [`39:1:2|${sale}`],
    indexed_checkpoint: async () => 40,
  }
  const mesh = {
    online_samples: async (keys: readonly string[]) => keys.map(() => [8, 12]),
    cluster_online: async () => 11,
  }
  const result = await get_admin_overview(graph as never, bus as never, mesh as never, {
    revenue_days: 30,
    players_days: 30,
    transactions_days: 30,
    online_days: 30,
    addresses_days: 30,
    characters_days: 30,
    now_ms,
  })
  expect(result.revenue.bucket).toBe('day')
  expect(result.players.dau).toBe(2)
  expect(result.players.rolling_30d).toBe(2)
  expect(result.transactions.total).toBe(5)
  expect(result.transactions.all_time).toBe(12)
  expect(result.transactions.gas_range_mist).toBe('100000000')
  expect(result.transactions.gas_all_time_mist).toBe('250000000')
  expect(result.revenue.shop_mist).toBe('120')
  expect(result.revenue.shop_orders).toBe('2')
  expect(result.revenue.character_creation_mist).toBe('1000')
  expect(result.revenue.kolizeum_mist).toBe('20')
  expect(result.revenue.last_30d_revenue_mist).toBe('1158')
  expect(result.revenue.month_to_date_revenue_mist).toBe('1158')
  expect(result.online.online_now).toBe(11)
  expect(result.online.online_average).toBe(10)
  expect(result.online.online_peak).toBe(12)
  expect(result.addresses.total).toBe(3)
  expect(result.characters.total).toBe(4)
})

test('ranges use compacted hourly, weekly, and monthly buckets while sales paginate', async () => {
  const seen: string[][] = []
  const graph = { read: async () => [{ total: 0 }] }
  const bus = {
    analytics_hashes: async (keys: readonly string[]) => {
      seen.push([...keys])
      return keys.map(() => ({}))
    },
    analytics_counts: async (keys: readonly string[]) => keys.map(() => 0),
    analytics_sums: async (keys: readonly string[]) => keys.map(() => 0),
    analytics_cumulative_counts: async (_key: string, maxes: readonly number[]) => [...maxes.map(() => 0), 0],
    analytics_sets: async (keys: readonly string[]) => keys.map(() => []),
    shop_sales: async (_min: number, _max: number, offset: number) =>
      Array.from({ length: offset === 0 ? 31 : 1 }, (_, index) => `${index}|${sale}`),
    indexed_checkpoint: async () => 40,
  }
  const mesh = { online_samples: async (keys: readonly string[]) => keys.map(() => []), cluster_online: async () => 0 }
  const overview = await get_admin_overview(graph as never, bus as never, mesh as never, {
    revenue_days: 7,
    players_days: 30,
    transactions_days: 7,
    online_days: 1,
    addresses_days: 90,
    characters_days: 365,
    now_ms,
  })
  expect(overview.revenue.bucket).toBe('hour')
  expect(overview.players.bucket).toBe('day')
  expect(overview.transactions.bucket).toBe('hour')
  expect(overview.online.bucket).toBe('15m')
  expect(overview.addresses.bucket).toBe('week')
  expect(overview.characters.bucket).toBe('month')
  expect(seen.flat().some((key) => key.includes('analytics:money:hour:'))).toBe(false)
  const first = await get_admin_shop_sales(bus as never, { days: 90, cursor: null, now_ms })
  expect(first.rows).toHaveLength(30)
  expect(first.next_cursor).toBe(`${now_ms}:30`)
  const second = await get_admin_shop_sales(bus as never, {
    days: 90,
    cursor: first.next_cursor,
    now_ms: now_ms + DAY,
  })
  expect(second.rows).toHaveLength(1)
  expect(second.next_cursor).toBeNull()
})
