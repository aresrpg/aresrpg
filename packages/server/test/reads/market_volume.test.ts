// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { get_market_volume } from '../../src/reads/get_market_volume.ts'

test('epoch volume sums exact checkpoint subtotals and resets at the epoch boundary', async () => {
  const redis = {
    get: async () => '99',
    hvals: async (key: string) => (key.endsWith(':100') ? ['9007199254740993', '17'] : []),
  }
  expect(await get_market_volume(redis, '100')).toBe('9007199254741010')
  expect(await get_market_volume(redis, '101')).toBe('0')
})

test('a missing or partial first epoch is unavailable, never a fabricated full-day zero', async () => {
  const hvals = async () => {
    throw new Error('must not read an incomplete epoch')
  }
  expect(await get_market_volume({ get: async () => null, hvals }, '100')).toBeNull()
  expect(await get_market_volume({ get: async () => '100', hvals }, '100')).toBeNull()
})

test('invalid indexed volume stays an observable failure', async () => {
  await expect(get_market_volume({ get: async () => '99', hvals: async () => ['-1'] }, '100')).rejects.toThrow()
})
