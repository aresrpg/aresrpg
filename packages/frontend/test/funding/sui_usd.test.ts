// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { read_sui_usd } from '../../src/funding/useSuiUsd.ts'

// Captured 2026-10-25 from https://1click.chaindefuser.com/v0/tokens, native SUI catalogue row.
const captured = { assetId: 'nep141:sui.omft.near', blockchain: 'sui', symbol: 'SUI', decimals: 9, price: 0.90794 }
const signal = () => new AbortController().signal
const respond = (body: unknown, status = 200) =>
  (async () => Response.json(body, { status })) as unknown as typeof fetch

test('the SUI estimate decodes a captured quote from the existing funding provider', async () => {
  expect(await read_sui_usd(signal(), respond([captured]))).toBe(0.90794)
})

test('invalid or foreign asset prices never become dollar estimates', async () => {
  for (const body of [
    null,
    {},
    [],
    [{ ...captured, assetId: 'nep141:eth.omft.near' }],
    ...[0, -1, '0.9', null].map((price) => [{ ...captured, price }]),
  ])
    await expect(read_sui_usd(signal(), respond(body))).rejects.toThrow()
  await expect(read_sui_usd(signal(), respond([captured], 503))).rejects.toThrow('unavailable')
})
