// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { read_sui_usd } from '../../src/funding/useSuiUsd.ts'

// Captured 2026-10-01 from LI.FI GET /v1/token?chain=9270000000000000&token=0x2::sui::SUI.
// Mainnet native SUI price response; unrelated metadata omitted.
const captured = {
  address: '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
  chainId: 9270000000000000,
  symbol: 'SUI',
  decimals: 9,
  priceUSD: '1.17',
}
const signal = () => new AbortController().signal
const respond = (body: unknown, status = 200) =>
  (async () => Response.json(body, { status })) as unknown as typeof fetch

test('the SUI estimate decodes a captured quote from the existing funding provider', async () => {
  expect(await read_sui_usd(signal(), respond(captured))).toBe(1.17)
})

test('missing, invalid, and foreign-token quotes never become dollar estimates', async () => {
  for (const body of [
    null,
    {},
    { ...captured, chainId: 1 },
    { ...captured, address: '0x2::other::OTHER' },
    ...['', '0', '-1', 'NaN', 'Infinity', null, 1.17].map((price_usd) => ({ ...captured, priceUSD: price_usd })),
  ])
    await expect(read_sui_usd(signal(), respond(body))).rejects.toThrow('Invalid SUI price')
  await expect(read_sui_usd(signal(), respond(captured, 503))).rejects.toThrow('unavailable')
})
