// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { get_analytics_totals, parse_analytics_totals, ZERO_TOTALS } from '../../src/reads/get_analytics_totals.ts'

test('compact reads preserve signed and large exact values and reject malformed or partial data', async () => {
  const value = { ...ZERO_TOTALS, checkpoint: 10, transactions: '9007199254740993', gas_mist: '-9007199254740993' }
  expect(parse_analytics_totals(JSON.stringify(value))).toEqual(value)
  expect(parse_analytics_totals(null)).toBe(ZERO_TOTALS)
  for (const broken of [
    null,
    {},
    { ...value, gas_mist: 2 },
    { ...value, transactions: '-1' },
    { ...value, checkpoint: -1 },
    { ...value, gas_mist: String(1n << 127n) },
  ])
    expect(() => parse_analytics_totals(JSON.stringify(broken))).toThrow()
  let reads = 0
  await expect(
    get_analytics_totals(
      {
        get: async () => null,
        mget: async () => {
          reads++
          return []
        },
      },
      ['analytics:totals:all']
    )
  ).rejects.toThrow('not initialized')
  expect(reads).toBe(0)
  await expect(
    get_analytics_totals({ get: async () => 'compact-v1', mget: async () => [] }, ['analytics:totals:all'])
  ).rejects.toThrow('incomplete')
  expect(
    await get_analytics_totals({ get: async () => 'compact-v1', mget: async () => [JSON.stringify(value), null] }, [
      'analytics:totals:all',
      'analytics:totals:day:0',
    ])
  ).toEqual([value, ZERO_TOTALS])
})
