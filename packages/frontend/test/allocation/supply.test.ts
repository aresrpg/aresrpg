// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { KARES_SUPPLY } from '@aresrpg/sdk/kares-economics'

import { load_app_copy } from '../../src/i18n/copy.ts'
import { kares_distribution } from '../../src/kares/distribution.ts'

test('the shared distribution accounts for all supply including sale and locked liquidity', async () => {
  const copy = (await load_app_copy('en')).kares_page
  const rows = kares_distribution(copy)
  expect(rows.reduce((sum, row) => sum + row.amount, 0n)).toBe(KARES_SUPPLY)
  expect(rows.find((row) => row.label === copy.token_sale)?.share).toBe(40)
  expect(rows.find((row) => row.label === copy.locked_liquidity)?.share).toBe(16)
  expect(rows.reduce((sum, row) => sum + row.share, 0)).toBe(100)
})
