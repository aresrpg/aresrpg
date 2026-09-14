// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { get_market_volume } from '../../src/reads/get_market_volume.ts'

const DAY = 86_400_000
const now = 40 * DAY + 12345
const rows = [
  `${now - 30 * DAY - 1}:1000`,
  `${now - 30 * DAY}:2000`,
  `${now - 30 * DAY + 1}:13`,
  `${now - DAY}:17`,
  `${now - DAY + 1}:9007199254740993`,
  `${now}:2`,
  `${now + 1}:500`,
]
const redis_for = (first: string | null) => ({
  get: async () => first,
  hvals: async (key: string) =>
    rows.filter((row) => Math.floor(Number(row.split(':')[0]) / DAY) === Number(key.split(':').at(-1))),
})

test('both rolling windows use exact timestamps and integer money, not day boundaries', async () => {
  expect(await get_market_volume(redis_for('0'), now)).toEqual({
    day_mist: '9007199254740995',
    month_mist: '9007199254741025',
  })
  expect(await get_market_volume(redis_for('0'), now + DAY)).toEqual({
    day_mist: '500',
    month_mist: '9007199254741512',
  })
})

test('each window becomes available only once its complete history exists', async () => {
  expect(await get_market_volume(redis_for(null), now)).toBeNull()
  expect(await get_market_volume(redis_for(String(now - DAY + 1)), now)).toEqual({ day_mist: null, month_mist: null })
  expect(await get_market_volume(redis_for(String(now - DAY)), now)).toEqual({
    day_mist: '9007199254740995',
    month_mist: null,
  })
  expect(await get_market_volume({ get: async () => '0', hvals: async () => [] }, now)).toEqual({
    day_mist: '0',
    month_mist: '0',
  })
})

test('invalid indexed timestamps or money remain observable failures', async () => {
  for (const row of ['broken', '1:-1', 'NaN:4'])
    await expect(get_market_volume({ get: async () => '0', hvals: async () => [row] }, now)).rejects.toThrow()
})
