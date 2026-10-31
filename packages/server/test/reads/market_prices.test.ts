// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { MARKET_PRICE_DAY_MS as DAY } from '@aresrpg/protocol'

import { get_market_prices, parse_price_bucket } from '../../src/reads/get_market_prices.ts'

const total = { total_mist: '9007199254740993', units: '1000', sales: '1', checkpoint: 10 }

test('uninitialized is unavailable; first-day history is valid and never reads before collection began', async () => {
  expect(await get_market_prices({ get: async () => null }, 'quartz', 1000)).toBeNull()
  const keys: string[] = []
  const reader = {
    get: async () => String(500 * DAY + 1000),
    pipeline: () => ({
      hget: (key: string, field: string) => {
        keys.push(key)
        expect(field).toBe('quartz')
      },
      exec: async (): Promise<[null, unknown][]> => [
        [null, JSON.stringify(total)],
        [null, null],
      ],
    }),
  }
  const result = await get_market_prices(reader, 'quartz', 501 * DAY + 2000)
  expect(keys).toEqual(['market:prices:day:500', 'market:prices:day:501'])
  expect(result).toEqual({
    first_timestamp_ms: 500 * DAY + 1000,
    sampled_at_ms: 501 * DAY + 2000,
    buckets: [{ at_ms: 500 * DAY, ...total }],
  })
})

test('a year is bounded to 366 daily fields, read in one pipeline, with exact decimal totals', async () => {
  const fields: string[] = []
  let executions = 0
  const result = await get_market_prices(
    {
      get: async () => '0',
      pipeline: () => ({
        hget: (key: string) => {
          fields.push(key)
        },
        exec: async (): Promise<[null, unknown][]> => {
          executions++
          return fields.map(() => [null, JSON.stringify(total)])
        },
      }),
    },
    'quartz',
    1000 * DAY + 1
  )
  expect(fields).toHaveLength(366)
  expect(fields[0]).toBe('market:prices:day:635')
  expect(executions).toBe(1)
  expect(result!.buckets[0]!.total_mist).toBe(total.total_mist)
})

test('corrupt, partial, or failed reads cannot masquerade as no trading', async () => {
  for (const value of [
    undefined,
    'invalid',
    'null',
    JSON.stringify({ ...total, units: '0' }),
    JSON.stringify({ ...total, total_mist: 9007199254740992 }),
    JSON.stringify({ ...total, checkpoint: -1 }),
    JSON.stringify({ ...total, total_mist: String(1n << 128n) }),
  ]) {
    expect(() => parse_price_bucket(value, 0)).toThrow()
  }
  for (const first of ['-1', 'bad', '1e20', String(1001)]) {
    await expect(get_market_prices({ get: async () => first }, 'quartz', 1000)).rejects.toThrow()
  }
  await expect(get_market_prices({ get: async () => '0' }, 'quartz', 1000)).rejects.toThrow()
  for (const results of [null, [], [[new Error('redis unavailable'), null]] as [Error, unknown][]]) {
    await expect(
      get_market_prices(
        { get: async () => '0', pipeline: () => ({ hget: () => undefined, exec: async () => results }) },
        'quartz',
        1000
      )
    ).rejects.toThrow()
  }
})

test('OHLC is optional for legacy records and validates exact positive sale ratios and ranges', () => {
  const price = (mist: string, units = '1000') => ({ mist, units })
  const ohlc = { open: price('3'), high: price('4'), low: price('1'), close: price('2') }
  expect(parse_price_bucket(JSON.stringify(total), 0)).toEqual({ at_ms: 0, ...total })
  expect(parse_price_bucket(JSON.stringify({ ...total, ohlc }), 0)?.ohlc).toEqual(ohlc)
  for (const invalid of [
    null,
    {},
    { ...ohlc, close: price('0') },
    { ...ohlc, low: price('1', '0') },
    { ...ohlc, high: price(String(1n << 64n)) },
    { ...ohlc, open: price('5') },
    { ...ohlc, low: price('5') },
    { ...ohlc, close: price('5') },
    { ...ohlc, open: { mist: 3, units: '1' } },
  ])
    expect(() => parse_price_bucket(JSON.stringify({ ...total, ohlc: invalid }), 0)).toThrow()
  const almost = {
    open: price('9007199254740992', '1'),
    high: price('9007199254740992', '1'),
    low: price('9007199254740992', '1'),
    close: price('9007199254740993', '1'),
  }
  expect(() => parse_price_bucket(JSON.stringify({ ...total, ohlc: almost }), 0)).toThrow()
})
