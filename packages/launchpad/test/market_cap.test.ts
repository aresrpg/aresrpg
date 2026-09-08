// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { read_usd_quote, usd_market_cap } from '../src/LaunchMarketCap.tsx'

test('USD display uses a validated spot quote and exact integer cents', () => {
  // Coinbase public SUI/USD spot response captured 2026-09-07; display-only, never a transaction input.
  const quote = read_usd_quote({ data: { amount: '0.8061', base: 'SUI', currency: 'USD' } })
  expect(usd_market_cap(29_500_000_000n, quote)).toBe('$23.78')
  expect(usd_market_cap(9_007_199_254_740_993n, 1_000_000_000n)).toBe('$9,007,199.25')
  for (const amount of ['0', '-1', 'NaN', 'Infinity', '1e100', '18446744073.709551616'])
    expect(() => read_usd_quote({ data: { amount, base: 'SUI', currency: 'USD' } })).toThrow()
  expect(() => read_usd_quote({ data: { amount: '1', base: 'BTC', currency: 'USD' } })).toThrow()
  expect(() => read_usd_quote({ data: { amount: '1', base: 'SUI', currency: 'EUR' } })).toThrow()
})
